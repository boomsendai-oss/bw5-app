'use server';

// BW6 発表会のスタッフの世帯の画面の Server Actions。/staff/* は proxy（cookie の有無）で覆われているが、
// proxy は DB を見られないので、どれも1行目で requireRecitalStaff() を呼んでセッションを本検証する（規約4.5）。
// 変更の控え・afterMoneyChanged・新しいアドレスへの URL のメールは、呼ぶ先（8・9）が中でする。ここでは送らない・呼ばない。
// 鍵（edit_token）とメールアドレスはログに出さない。
// あとのタスク（23・20・28）は、このファイルに足す（世帯の画面の操作はここにまとめる）。28 は「この入金を取り消す」（cancelBankPaymentAction）を足した。
import { revalidatePath } from 'next/cache';
import { isIsoDate, todayJst } from '@/lib/dateJst';
import { RECITAL_STAFF_NAMES, jstToMs, recitalMyUrl, type FeeClass } from '@/lib/recital';
import { cancelBankPayment } from '@/lib/recitalBankDb';
import { loadHouseholdDetail, searchHouseholds, type HouseholdHit } from '@/lib/recitalDb';
import { applyHouseholdEdits, changeHouseholdEmail, type HouseholdEdit } from '@/lib/recitalEntryDb';
import { requireRecitalStaff } from '@/lib/recitalGuard';
import { sendPaidMail, sendRecitalMail } from '@/lib/recitalMail';
import { cancelRefund, readHouseholdMoney, recordManualPayment } from '@/lib/recitalMoneyDb';
import { parseYenInput, reversedBankPaymentIds } from '@/lib/recitalMyPage';
import { markBankTold } from '@/lib/recitalPayDb';
import type { MemberLite } from '@/lib/recitalMatch';
import {
  addAdjustCharge, decideMemberMatch, listMatchCandidates, mergeHouseholds, setFeeClass, voidAdjustCharge, type FeeChangePreview,
} from '@/lib/recitalStaffDb';
import { EDIT_FAIL_LABEL, labelOf, mailStatusLabel } from '../../labels';
import { editPreview, type EditPreview } from './editorModel';

type Fail = { ok: false; error: string };

const NAME_ERROR = '名前を選んでください';
const isId = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const isBlank = (s: unknown) => typeof s !== 'string' || s.trim() === '';
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const NOT_ACTIVE = 'この世帯はまとめた（または有効でない）ので、できません';

/** 世帯が active か（まとめた世帯にはお金・メールの操作をさせない）。無い・active でなければ失敗の文 */
async function activeCheck(householdId: number): Promise<string | null> {
  const d = await loadHouseholdDetail(householdId);
  if (!d) return '世帯が見つかりません';
  return d.household.status === 'active' ? null : NOT_ACTIVE;
}

function done(householdId: number): void {
  revalidatePath('/staff/bw6/entries/' + householdId);
}

/** datetime-local の 'YYYY-MM-DDTHH:MM'（JST）→ UTC ISO。空は null、読めなければ NaN の印として undefined */
function receivedAtToIso(v: string | null): string | null | undefined {
  if (v == null || v.trim() === '') return null;
  const ms = jstToMs(v.trim().replace('T', ' '));
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString();
}

/**
 * 代わりに直す。dryRun なら書かずに、合計・残り・お支払いずみの分の前→あとと追加分を返す（K227。画面の「確かめる」）。
 * 前→あとは今の払った額（readHouseholdMoney）と editPreview（式は moneySummary）で出す。理由が空なら拒む。家庭から聞いた日時は任意。
 */
export async function editHouseholdAction(
  householdId: number,
  edits: HouseholdEdit[],
  x: { reason: string; receivedAtJst: string | null; staffName: string; dryRun?: boolean },
): Promise<({ ok: true } & EditPreview) | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId)) return { ok: false, error: EDIT_FAIL_LABEL.invalid };
  if (!RECITAL_STAFF_NAMES.includes(x?.staffName)) return { ok: false, error: NAME_ERROR };
  if (isBlank(x.reason)) return { ok: false, error: '理由を入れてください' };
  const receivedAt = receivedAtToIso(x.receivedAtJst);
  if (receivedAt === undefined) return { ok: false, error: '日時を確かめてください' };
  if (!Array.isArray(edits) || edits.length === 0) return { ok: false, error: '変えた欄がありません' };

  // 前→あとの「払った額」は、直す前に読む（直しのあとの仕事で返す分ができても、確かめの数が動かないように）
  let paid: number;
  try {
    paid = (await readHouseholdMoney(householdId)).m.paid;
  } catch {
    return { ok: false, error: '世帯が見つかりません' };
  }
  const r = await applyHouseholdEdits(householdId, edits, {
    actor: x.staffName, by: 'staff', reason: x.reason.trim(), receivedAt, dryRun: x.dryRun === true,
  });
  if (!r.ok) return { ok: false, error: labelOf(EDIT_FAIL_LABEL, r.code) };
  if (x.dryRun !== true) done(householdId);
  return { ok: true, ...editPreview(r.totalBefore, r.totalAfter, paid) };
}

/** マイページの URL（家庭向けのドメイン）。押した時だけ渡す（初めの HTML に鍵を入れない）。記録・ログに鍵を出さない */
export async function myPageUrlAction(householdId: number): Promise<{ url: string }> {
  await requireRecitalStaff();
  if (!isId(householdId)) throw new Error('recital_staff:bad_input');
  const d = await loadHouseholdDetail(householdId);
  if (!d) throw new Error('recital_staff:no_household');
  return { url: recitalMyUrl(d.household.edit_token) };
}

/** 受付の控えを送り直す（08「直ったあとに控えを送り直す」）。送った・失敗などの status を返す */
export async function resendReceiptAction(householdId: number): Promise<{ ok: true; status: string } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId)) return { ok: false, error: '世帯が見つかりません' };
  const bad = await activeCheck(householdId);
  if (bad) return { ok: false, error: bad };
  try {
    const r = await sendRecitalMail({ kind: 'receipt', householdId });
    done(householdId);
    return { ok: true, status: r.status };
  } catch (e) {
    console.error(`[recital] 控えを送り直せませんでした household=${householdId}`, errMsg(e));
    return { ok: false, error: '送れませんでした。もう一度押してください' };
  }
}

/**
 * メールアドレスを直す（鍵も作り直す＝古い URL は使えない。新しいアドレスへの URL のメールは 8 が中で送る）。
 * 返す mailStatus は、そのあとのいちばん新しい URL のメールの行の状態の言葉（送った・失敗など。行が無ければ null）。
 */
export async function changeEmailAction(householdId: number, email: string, staffName: string): Promise<{ ok: true; mailStatus: string | null; mailSent: boolean } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId)) return { ok: false, error: '世帯が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  const e = typeof email === 'string' ? email.trim() : '';
  if (e === '' || e.split('@').length !== 2 || /\s/.test(e)) return { ok: false, error: 'メールアドレスの形で入れてください' };
  const bad = await activeCheck(householdId);
  if (bad) return { ok: false, error: bad };
  try {
    await changeHouseholdEmail(householdId, e, staffName);
  } catch (err) {
    const m = errMsg(err);
    if (m.includes('same_email')) return { ok: false, error: 'このアドレスは、ほかの申込で使われています' };
    if (m.includes('not_active')) return { ok: false, error: NOT_ACTIVE };
    if (m.includes('bad_email')) return { ok: false, error: 'メールアドレスの形で入れてください' };
    if (m.includes('no_household')) return { ok: false, error: '世帯が見つかりません' };
    throw err;
  }
  done(householdId);
  const mail = (await loadHouseholdDetail(householdId))?.mails.find((m) => m.mail_kind === 'resend_url') ?? null;
  return { ok: true, mailStatus: mail ? mailStatusLabel(mail) : null, mailSent: mail?.status === 'sent' };
}

/**
 * 手で入金を記録（現金／調整だけ。振込は「見てほしい入金」から当てる）。決まりは 9 の recordManualPayment と同じ：
 * 現金は1以上の整数、調整は0でない整数でメモ必須。日は今日（JST）まで。まとめた世帯は拒む。afterMoneyChanged は中で呼ばれる。ここは sendPaidMail だけ。
 * 返す mail は送ったメールの種類と状態（sent・waiting・failed・duplicate。送らなかった時は null）。
 */
export async function recordManualPaymentAction(
  householdId: number,
  x: { method: 'cash' | 'adjust'; amount: number; paidOn: string; memo: string },
  staffName: string,
): Promise<{ ok: true; mail: { kind: string; status: string } | null } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId)) return { ok: false, error: '世帯が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (x?.method !== 'cash' && x?.method !== 'adjust') return { ok: false, error: '払い方を選んでください' };
  if (x.method === 'cash' && !(Number.isInteger(x.amount) && x.amount >= 1)) return { ok: false, error: '金額は1円以上の整数で入れてください' };
  if (x.method === 'adjust' && !(Number.isInteger(x.amount) && x.amount !== 0)) return { ok: false, error: '調整の金額は0でない整数で入れてください' };
  if (!isIsoDate(x.paidOn) || x.paidOn > todayJst()) return { ok: false, error: '日を確かめてください（先の日は入れられません）' };
  const memo = typeof x.memo === 'string' ? x.memo.trim() : '';
  if (x.method === 'adjust' && memo === '') return { ok: false, error: '調整はメモを入れてください' };
  const bad = await activeCheck(householdId);
  if (bad) return { ok: false, error: bad };

  let paymentId: number;
  try {
    paymentId = (await recordManualPayment(householdId, { method: x.method, amount: x.amount, paidOn: x.paidOn, memo }, staffName)).paymentId;
  } catch (e) {
    const m = errMsg(e);
    if (m.includes('recital_money:negative')) return { ok: false, error: '払った額がマイナスになります' };
    if (m.includes('recital_money:not_active')) return { ok: false, error: NOT_ACTIVE };
    if (m.includes('recital_money:')) return { ok: false, error: '入れた値を確かめてください' };
    throw e;
  }
  done(householdId);
  try {
    const r = await sendPaidMail(householdId, paymentId, x.method);
    return { ok: true, mail: 'kind' in r ? { kind: r.kind, status: r.status } : null };
  } catch (e) {
    // 入金はもう記録できている。メールの失敗はログだけにして、記録は成り立ったと返す
    console.error(`[recital] 入金のあとのメールを送れませんでした household=${householdId}`, errMsg(e));
    return { ok: true, mail: null };
  }
}

/**
 * 返す分（todo）を取り消す。理由必須。afterMoneyChanged は cancelRefund が中で呼ぶ。
 * まとめた世帯は拒む（Task 28 で決め直した：世帯の画面のお金の操作はどれも、まとめた世帯ではさせない。まとめる前に返す分 todo は片づけてある）
 */
export async function cancelRefundAction(householdId: number, refundId: number, reason: string, staffName: string): Promise<{ ok: true } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId) || !isId(refundId)) return { ok: false, error: '返す分が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (isBlank(reason)) return { ok: false, error: '理由を入れてください' };
  const d = await loadHouseholdDetail(householdId);
  if (d && d.household.status !== 'active') return { ok: false, error: NOT_ACTIVE };
  if (!d || !d.refunds.some((r) => r.id === refundId && r.status === 'todo')) return { ok: false, error: '返す分が見つかりません（もう取り消したかもしれません）' };
  try {
    await cancelRefund(refundId, reason.trim(), staffName);
  } catch (e) {
    if (errMsg(e).includes('recital_money:')) return { ok: false, error: '取り消せませんでした（もう取り消したかもしれません）' };
    throw e;
  }
  done(householdId);
  return { ok: true };
}

/** 2人が同時に押した時の文（row_over・live_exists・busy。Task 28） */
const BANK_RACE = 'ほかの人が、いま同じ入金を当てました。画面を開き直してください';
const CANCEL_REASONS: readonly string[] = ['wrong_household', 'misread'];

/**
 * 「この入金を取り消す」（Task 28・D5 2-24。K200・K202）。formData：householdId・paymentId・reason（wrong_household｜misread）・staffName。
 * まとめた世帯は拒む。マイナスの行・返す分の片づけ・印をもどす・待ちのメールの取りやめは cancelBankPayment が1回の書き込みでする。メールは出さない。
 */
export async function cancelBankPaymentAction(formData: FormData): Promise<{ ok: true } | Fail> {
  await requireRecitalStaff();
  const householdId = Number(formData.get('householdId'));
  const paymentId = Number(formData.get('paymentId'));
  const reason = String(formData.get('reason') ?? '');
  const staffName = String(formData.get('staffName') ?? '');
  if (!isId(householdId) || !isId(paymentId)) return { ok: false, error: '入金が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (!CANCEL_REASONS.includes(reason)) return { ok: false, error: '理由を選んでください' };
  const d = await loadHouseholdDetail(householdId);
  if (!d) return { ok: false, error: '世帯が見つかりません' };
  if (d.household.status !== 'active') return { ok: false, error: NOT_ACTIVE };
  const p = d.payments.find((x) => x.id === paymentId && x.method === 'bank' && x.amount > 0 && x.bank_transaction_id != null);
  if (!p || reversedBankPaymentIds(d.payments).has(paymentId)) return { ok: false, error: 'この入金は取り消せません（もう取り消したかもしれません）。画面を開き直してください' };
  let r: Awaited<ReturnType<typeof cancelBankPayment>>;
  try {
    r = await cancelBankPayment(paymentId, reason as 'wrong_household' | 'misread', staffName);
  } catch (e) {
    const m = errMsg(e);
    if (m === 'busy' || m.includes('recital_money:row_over') || m.includes('recital_money:live_exists')) return { ok: false, error: BANK_RACE };
    if (m === 'already_cancelled') return { ok: false, error: 'この入金は、もう取り消してあります。画面を開き直してください' };
    if (m === 'merged') return { ok: false, error: NOT_ACTIVE };
    if (m === 'not_found' || m === 'bad_state') return { ok: false, error: 'この入金は取り消せません。画面を開き直してください' };
    if (m === 'reason_required') return { ok: false, error: '理由を選んでください' };
    throw e;
  }
  if (!r.ok) {
    if (r.code === 'refund_done') {
      const now = await loadHouseholdDetail(householdId);
      const doneSum = (now ?? d).refunds.filter((x) => x.source_payment_id === paymentId && x.status === 'done').reduce((a, x) => a + Number(x.amount), 0);
      return { ok: false, error: `この入金から、もう ${doneSum.toLocaleString('ja-JP')}円を返しています。先に、TARO に知らせてください` };
    }
    return { ok: false, error: '払った額が 0 円より少なくなるため、取り消せません。作る人に知らせてください' };
  }
  done(householdId);
  revalidatePath('/staff/bw6');
  return { ok: true };
}

/**
 * 「振り込みましたの印を付ける」（Task 23・D5 2-20。公式LINEで「振り込みました」と連絡が来たとき、家庭の代わりに付ける）。
 * 決まりは家庭の「振り込みました」と同じ（markBankTold。by=staff）：先の日は不可・残りがある間だけ・印があれば日・お名前・金額だけ直す。
 * まとめた世帯は拒む。お名前・金額はログに出さない。
 */
export async function markBankToldByStaffAction(
  householdId: number,
  x: { date: string; name: string; amount: string },
  staffName: string,
): Promise<{ ok: true } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId)) return { ok: false, error: '世帯が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (!x || typeof x.date !== 'string' || typeof x.name !== 'string' || typeof x.amount !== 'string') return { ok: false, error: '入れた値を確かめてください' };
  if (!isIsoDate(x.date)) return { ok: false, error: '日を確かめてください（先の日は入れられません）' };
  if (isBlank(x.name)) return { ok: false, error: 'お名前を入れてください' };
  const amount = parseYenInput(x.amount);
  if (amount == null) return { ok: false, error: '金額は1円以上の整数で入れてください' };
  const bad = await activeCheck(householdId);
  if (bad) return { ok: false, error: bad };
  try {
    const r = await markBankTold(householdId, { date: x.date, name: x.name, amount }, 'staff', staffName);
    if (!r.ok) {
      return { ok: false, error: r.code === 'future' ? '日を確かめてください（先の日は入れられません）' : '残りが無いので、印は付けられません' };
    }
  } catch (e) {
    const m = errMsg(e);
    if (m.includes('recital_pay:bad_input')) return { ok: false, error: '入れた値を確かめてください' };
    throw e;
  }
  done(householdId);
  return { ok: true };
}

// =====================================================================
// Task 20：特別な料金（そのほかの金額の直し）・世帯をまとめる・照合を決める。
// お金の式と書き込みは src/lib/recitalStaffDb.ts。ここは守り（requireRecitalStaff・名前・まとめた世帯を拒む）と、失敗の文だけ。
// dryRun は書かない（押す前の確かめ）。合計が変わった時の afterMoneyChanged・変更の控えは lib が中でする。
// =====================================================================

const HOUSEHOLD_PAGE = '/staff/bw6/entries/[id]';

/** 人の操作のあと：どの世帯の画面かを引かずに、世帯の画面をまとめて出し直す（どれも force-dynamic） */
function donePerson(): void {
  revalidatePath(HOUSEHOLD_PAGE, 'page');
  revalidatePath('/staff/bw6');
}

/** lib の throw（recital_staff:…）を画面の文にする。知らない物は投げ直す */
function staffError(e: unknown): string {
  const m = errMsg(e);
  if (m.includes('recital_staff:staff_name')) return NAME_ERROR;
  if (m.includes('recital_staff:reason')) return '理由を入れてください';
  if (m.includes('recital_staff:not_active')) return NOT_ACTIVE;
  if (m.includes('recital_staff:no_person')) return '人が見つかりません';
  if (m.includes('recital_staff:no_member')) return '会員が見つかりません';
  if (m.includes('recital_staff:fee_class') || m.includes('recital_staff:bad_choice')) return '入れた値を確かめてください';
  throw e;
}

const FEE_CLASS_INPUTS: readonly (FeeClass)[] = [null, 'no_coop', 'tshirt_only', 'free'];

/** 特別な料金の種類を直す（金額は打たせない）。dryRun なら「今の合計 → 直したあと」と返す分・追加分だけ返す */
export async function feeClassAction(
  personId: number, feeClass: FeeClass, reason: string, staffName: string, dryRun: boolean,
): Promise<({ ok: true } & FeeChangePreview) | Fail> {
  await requireRecitalStaff();
  if (!isId(personId)) return { ok: false, error: '人が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (!FEE_CLASS_INPUTS.includes(feeClass)) return { ok: false, error: '種類を選んでください' };
  if (isBlank(reason)) return { ok: false, error: '理由を入れてください' };
  try {
    const r = await setFeeClass(personId, feeClass, reason.trim(), staffName, { dryRun: dryRun === true });
    if (dryRun !== true) donePerson();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: staffError(e) };
  }
}

/** そのほかの金額の直し（3つの種類の外の額だけ）。下げる時は今の合計をこえられない */
export async function adjustAction(
  householdId: number,
  x: { direction: 'down' | 'up'; amount: number; reason: string },
  staffName: string,
  dryRun: boolean,
): Promise<{ ok: true; totalBefore: number; totalAfter: number } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId)) return { ok: false, error: '世帯が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (x?.direction !== 'down' && x?.direction !== 'up') return { ok: false, error: '下げる・上げるを選んでください' };
  if (!(Number.isInteger(x.amount) && x.amount >= 1)) return { ok: false, error: '金額は1円以上の整数で入れてください' };
  if (isBlank(x.reason)) return { ok: false, error: '理由を入れてください' };
  const bad = await activeCheck(householdId);
  if (bad) return { ok: false, error: bad };
  const r = await addAdjustCharge(householdId, { direction: x.direction, amount: x.amount, reason: x.reason.trim() }, staffName, { dryRun: dryRun === true });
  if (!r.ok) {
    if (r.code === 'not_active') return { ok: false, error: NOT_ACTIVE };
    return { ok: false, error: r.code === 'over_total' ? '今の合計より多くは下げられません' : '入れた値を確かめてください' };
  }
  if (dryRun !== true) done(householdId);
  return r;
}

/** 手の調整の行を取り消す（理由必須）。その世帯の生きている adjust の行だけ */
export async function voidAdjustAction(householdId: number, chargeId: number, reason: string, staffName: string): Promise<{ ok: true } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId) || !isId(chargeId)) return { ok: false, error: '行が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (isBlank(reason)) return { ok: false, error: '理由を入れてください' };
  const d = await loadHouseholdDetail(householdId);
  if (!d) return { ok: false, error: '世帯が見つかりません' };
  if (d.household.status !== 'active') return { ok: false, error: NOT_ACTIVE };
  if (!d.charges.some((c) => c.id === chargeId && c.item_code === 'adjust' && c.status === 'active')) {
    return { ok: false, error: '行が見つかりません（もう取り消したかもしれません）' };
  }
  const r = await voidAdjustCharge(chargeId, reason.trim(), staffName);
  if (!r.ok) return { ok: false, error: '取り消せませんでした（もう取り消したかもしれません）' };
  done(householdId);
  return { ok: true };
}

const MERGE_FAIL_LABEL: Record<string, string> = {
  same: '同じ世帯です',
  not_active: 'もうまとめてあります。画面を開き直してください',
  other_event: 'ちがう発表会の世帯です',
  has_adjust: 'まとめられる方に「手の調整」があります。先に取り消してください',
  has_refund_todo: 'まとめられる方に、まだ返していない「返す分」があります。先に片づけてください',
  bad_pair: '同じ人の組を確かめてください',
};

/** 世帯をまとめる（from を into へ）。dryRun なら「合計 → 合計」・移す入金・返す分だけ返す */
export async function mergeAction(
  fromId: number,
  intoId: number,
  x: { reason: string; samePeople: { dropPersonId: number; keepPersonId: number }[] },
  staffName: string,
  dryRun: boolean,
): Promise<{ ok: true; totalBefore: number; totalAfter: number; moved: number; refund: number } | Fail> {
  await requireRecitalStaff();
  if (!isId(fromId) || !isId(intoId)) return { ok: false, error: '世帯が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (isBlank(x?.reason)) return { ok: false, error: '理由を入れてください' };
  if (!Array.isArray(x.samePeople)) return { ok: false, error: MERGE_FAIL_LABEL.bad_pair };
  let r: Awaited<ReturnType<typeof mergeHouseholds>>;
  try {
    r = await mergeHouseholds(fromId, intoId, { reason: x.reason.trim(), samePeople: x.samePeople }, staffName, { dryRun: dryRun === true });
  } catch (e) {
    return { ok: false, error: staffError(e) };
  }
  if (!r.ok) return { ok: false, error: labelOf(MERGE_FAIL_LABEL, r.code) };
  if (dryRun !== true) {
    revalidatePath('/staff/bw6/entries/' + fromId);
    revalidatePath('/staff/bw6/entries/' + intoId);
    revalidatePath('/staff/bw6');
  }
  return r;
}

/** 照合を決める（会員と結ぶ／会員ではない）。dryRun なら金額の前→あとと、事前登録の種類・残る印だけ返す */
export async function matchAction(
  personId: number,
  choice: { memberId: number } | { none: true },
  reason: string,
  staffName: string,
  dryRun: boolean,
): Promise<({ ok: true } & Awaited<ReturnType<typeof decideMemberMatch>>) | Fail> {
  await requireRecitalStaff();
  if (!isId(personId)) return { ok: false, error: '人が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (isBlank(reason)) return { ok: false, error: '理由を入れてください' };
  const c = choice && 'none' in choice && choice.none === true ? { none: true as const } : choice && 'memberId' in choice && isId(choice.memberId) ? { memberId: choice.memberId } : null;
  if (!c) return { ok: false, error: '会員を選んでください' };
  try {
    const r = await decideMemberMatch(personId, c, reason.trim(), staffName, { dryRun: dryRun === true });
    if (dryRun !== true) donePerson();
    return { ok: true, ...r };
  } catch (e) {
    return { ok: false, error: staffError(e) };
  }
}

/** 照合の候補（名前・カナ・生年月日・状態）と、その発表会の事前登録 */
export async function matchCandidatesAction(personId: number): Promise<{ candidates: MemberLite[]; presets: Record<number, string> }> {
  await requireRecitalStaff();
  if (!isId(personId)) return { candidates: [], presets: {} };
  try {
    return await listMatchCandidates(personId);
  } catch (e) {
    if (errMsg(e).includes('recital_staff:no_person')) return { candidates: [], presets: {} };
    throw e;
  }
}

/** 世帯をまとめる欄の探す所（16 の searchHouseholds。鍵・メール・電話は返さない） */
export async function searchHouseholdsAction(eventKey: string, q: string): Promise<HouseholdHit[]> {
  await requireRecitalStaff();
  if (typeof eventKey !== 'string' || eventKey === '' || typeof q !== 'string') return [];
  return searchHouseholds(eventKey, q.slice(0, 50));
}

/** 世帯をまとめる欄の「同じ人の組」を作るための、相手の世帯の生きている人（名前・カナ・生年月日だけ。Task 20 で足した名前） */
export async function householdPeopleAction(householdId: number): Promise<{ id: number; name: string; kana: string; birthday: string }[]> {
  await requireRecitalStaff();
  if (!isId(householdId)) return [];
  const d = await loadHouseholdDetail(householdId);
  if (!d) return [];
  return d.people.filter((p) => p.status === 'active').map((p) => ({
    id: p.id,
    name: `${p.last_name} ${p.first_name ?? ''}`.trim(),
    kana: `${p.last_kana ?? ''} ${p.first_kana ?? ''}`.trim(),
    birthday: p.birthday ?? '',
  }));
}
