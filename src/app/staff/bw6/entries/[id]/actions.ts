'use server';

// BW6 発表会のスタッフの世帯の画面の Server Actions。/staff/* は proxy（cookie の有無）で覆われているが、
// proxy は DB を見られないので、どれも1行目で requireRecitalStaff() を呼んでセッションを本検証する（規約4.5）。
// 変更の控え・afterMoneyChanged・新しいアドレスへの URL のメールは、呼ぶ先（8・9）が中でする。ここでは送らない・呼ばない。
// 鍵（edit_token）とメールアドレスはログに出さない。
// あとのタスク（23・20・28）は、このファイルに足す（世帯の画面の操作はここにまとめる）。
import { revalidatePath } from 'next/cache';
import { isIsoDate, todayJst } from '@/lib/dateJst';
import { RECITAL_STAFF_NAMES, jstToMs, recitalMyUrl } from '@/lib/recital';
import { loadHouseholdDetail } from '@/lib/recitalDb';
import { applyHouseholdEdits, changeHouseholdEmail, type HouseholdEdit } from '@/lib/recitalEntryDb';
import { requireRecitalStaff } from '@/lib/recitalGuard';
import { sendPaidMail, sendRecitalMail } from '@/lib/recitalMail';
import { cancelRefund, readHouseholdMoney, recordManualPayment } from '@/lib/recitalMoneyDb';
import { parseYenInput } from '@/lib/recitalMyPage';
import { markBankTold } from '@/lib/recitalPayDb';
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

/** 返す分（todo）を取り消す。理由必須。afterMoneyChanged は cancelRefund が中で呼ぶ */
export async function cancelRefundAction(householdId: number, refundId: number, reason: string, staffName: string): Promise<{ ok: true } | Fail> {
  await requireRecitalStaff();
  if (!isId(householdId) || !isId(refundId)) return { ok: false, error: '返す分が見つかりません' };
  if (!RECITAL_STAFF_NAMES.includes(staffName)) return { ok: false, error: NAME_ERROR };
  if (isBlank(reason)) return { ok: false, error: '理由を入れてください' };
  const d = await loadHouseholdDetail(householdId);
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
