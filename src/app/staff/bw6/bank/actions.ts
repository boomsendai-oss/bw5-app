'use server';

// BW6 発表会のスタッフの「見てほしい入金」（/staff/bw6/bank）の Server Actions（Task 29）。
// /staff/* は proxy（cookie の有無）で覆われているが、proxy は DB を見られないので、どれも1行目で requireRecitalStaff() を呼ぶ（規約4.5）。
// 当てる・状態を変える・もとにもどす・同じ入金にするの中身は 28 の関数（assignBankRow・setBankRowState・restoreBankRow・mergeManualRow）がする。
// ここでは名前と形を確かめ、まとめた世帯を拒み、投げられた語を日本語の文に直す（生の例外の文を画面に出さない）。
// ログに名義・世帯の名前・金額を出さない（行の番号と短い語だけ）。
// 「同じ入金にする」は mergeManualAction（世帯の画面の「世帯をまとめる」とは別の名前）。
import { revalidatePath } from 'next/cache';
import { RECITAL_STAFF_NAMES, pickStaffEventKey } from '@/lib/recital';
import { assignBankRow, mergeManualRow, restoreBankRow, setBankRowState } from '@/lib/recitalBankDb';
import { loadHouseholdDetail, readMoneyByHousehold, searchHouseholds } from '@/lib/recitalDb';
import { requireRecitalStaff } from '@/lib/recitalGuard';

type Result = { ok: true } | { ok: false; error: string; code?: 'confirm_flag' };

const NAME_ERROR = '名前を選んでください';
/** 2人が同時に押した時の文（busy・bad_state・row_over・live_exists。Task 28） */
const BANK_RACE = 'ほかの人が、いま同じ入金を当てました。画面を開き直してください';
const NOT_ACTIVE = 'この世帯はまとめた（または有効でない）ので、当てられません';
const MEMO_MAX = 200;
const REASON_MAX = 200;

const isId = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const isYen = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const okName = (s: unknown): s is string => typeof s === 'string' && RECITAL_STAFF_NAMES.includes(s);

/** 28 の関数が投げた語 → 画面の文。知らない語は短い語だけをログに出して、ふつうの文にする */
function toMessage(e: unknown, where: string): { error: string; code?: 'confirm_flag' } {
  const m = errMsg(e);
  if (m === 'busy' || m === 'bad_state' || m.includes('recital_money:row_over') || m.includes('recital_money:live_exists')) return { error: BANK_RACE };
  if (m === 'merged' || m.includes('recital_money:not_active')) return { error: NOT_ACTIVE };
  if (m === 'confirm_flag') return { error: '印のある行があります。印の文を読んで「確かめました」に印を付けてから、もう一度押してください', code: 'confirm_flag' };
  if (m === 'bad_alloc') return { error: '金額の合計が、入金の額と合いません（2つに分ける時は、ちがう世帯を2つ選んでください）' };
  if (m === 'not_found') return { error: '入金か世帯が見つかりません。画面を開き直してください' };
  if (m === 'has_payment') return { error: 'この入金は、もう当ててあります。画面を開き直してください' };
  if (m === 'reason_required') return { error: 'もどす理由を書いてください' };
  if (m === 'key_taken') return { error: '同じ入金の行が、もう台帳にあります。この行はもどせません' };
  if (m.includes('recital_money:negative')) return { error: '払った額が 0 円より少なくなるため、できません。作る人に知らせてください' };
  console.error(`[recital] 見てほしい入金の操作ができませんでした action=${where}`, m.startsWith('recital_') ? m : 'error');
  return { error: '記録できませんでした。画面を開き直して、もう一度押してください' };
}

const READ_FAIL = '読めませんでした。少し待ってから、もう一度押してください';

/** 世帯が active か（まとめた世帯には当てない）。無い・active でなければ失敗の文。読めない時も文を返す（例外を画面に出さない） */
async function activeCheck(householdId: number): Promise<string | null> {
  try {
    const d = await loadHouseholdDetail(householdId);
    if (!d) return '世帯が見つかりません。画面を開き直してください';
    return d.household.status === 'active' ? null : NOT_ACTIVE;
  } catch (e) {
    console.error('[recital] 見てほしい入金で世帯を読めませんでした', errMsg(e).startsWith('recital_') ? errMsg(e) : 'error');
    return READ_FAIL;
  }
}

function done(): void {
  revalidatePath('/staff/bw6/bank');
  revalidatePath('/staff/bw6');
}

export type BankSearchHit = { householdId: number; refCode: string; contactName: string; status: string; remaining: number };

/**
 * 候補に無い家庭を探す（16 の searchHouseholds。鍵・メール・電話は返さない）。今の残りも付ける（2つに分ける時の初めの値）。
 * 残りは発表会ごとに1回で読む（readMoneyByHousehold。世帯ごとに引かない）。
 */
export async function searchHouseholdsForBankAction(ev: string, q: string): Promise<{ ok: true; hits: BankSearchHit[] } | { ok: false; error: string }> {
  await requireRecitalStaff();
  if (typeof q !== 'string' || q.trim() === '') return { ok: true, hits: [] };
  const eventKey = pickStaffEventKey(ev);
  try {
    const hits = await searchHouseholds(eventKey, q.slice(0, 50));
    if (hits.length === 0) return { ok: true, hits: [] };
    const money = await readMoneyByHousehold(eventKey);
    return {
      ok: true,
      hits: hits.map((h) => ({ householdId: h.id, refCode: h.ref_code, contactName: h.contact_name, status: h.status, remaining: money.get(h.id)?.remaining ?? 0 })),
    };
  } catch (e) {
    console.error('[recital] 見てほしい入金で家庭を探せませんでした', errMsg(e).startsWith('recital_') ? errMsg(e) : 'error');
    return { ok: false, error: '探せませんでした。少し待ってから、もう一度押してください' };
  }
}

/**
 * 「この世帯に当てる」（のこりの行も）。金額は行ののこり全部（assignBankRow が書き込みの中でのこりと合うかを確かめる）。
 * sendRemaining は short の時だけ画面で選ぶ（ほかは false）。印のある行は、画面で確かめてから confirmFlag: true。
 */
export async function assignAction(x: {
  rowId: number; householdId: number; amount: number; sendRemaining: boolean; confirmFlag: boolean; staffName: string;
}): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  if (!isId(x.rowId) || !isId(x.householdId)) return { ok: false, error: '世帯を選んでください' };
  if (!isYen(x.amount)) return { ok: false, error: '金額が読めません。画面を開き直してください' };
  const ng = await activeCheck(x.householdId);
  if (ng) return { ok: false, error: ng };
  try {
    await assignBankRow(x.rowId, [{ householdId: x.householdId, amount: x.amount }], { sendRemaining: x.sendRemaining === true, confirmFlag: x.confirmFlag === true }, x.staffName);
  } catch (e) {
    return { ok: false, ...toMessage(e, 'assign') };
  }
  done();
  return { ok: true };
}

/** 「2つの世帯に分ける」。2つの世帯はちがう世帯で、金額の合計は行の額と同じ（画面でも押せないようにしている） */
export async function splitAction(x: {
  rowId: number; parts: { householdId: number; amount: number }[]; confirmFlag: boolean; staffName: string;
}): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  if (!isId(x.rowId)) return { ok: false, error: '入金が見つかりません。画面を開き直してください' };
  const parts = Array.isArray(x.parts) ? x.parts : [];
  if (parts.length !== 2 || parts.some((p) => !p || !isId(p.householdId)) || parts[0].householdId === parts[1].householdId) {
    return { ok: false, error: 'ちがう世帯を2つ選んでください' };
  }
  if (parts.some((p) => !isYen(p.amount))) return { ok: false, error: '金額は 1円以上の数で入れてください' };
  for (const p of parts) {
    const ng = await activeCheck(p.householdId);
    if (ng) return { ok: false, error: ng };
  }
  try {
    await assignBankRow(x.rowId, parts.map((p) => ({ householdId: p.householdId, amount: p.amount })), { sendRemaining: false, confirmFlag: x.confirmFlag === true }, x.staffName);
  } catch (e) {
    return { ok: false, ...toMessage(e, 'split') };
  }
  done();
  return { ok: true };
}

/** 「発表会ではない」（まとめても）・「保留」（メモ）・「読みまちがいにする」 */
export async function setStateAction(x: {
  rowIds: number[]; state: 'not_recital' | 'hold' | 'void'; memo: string | null; staffName: string;
}): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  const ids = Array.isArray(x.rowIds) ? x.rowIds : [];
  if (ids.length === 0) return { ok: false, error: '行を選んでください' };
  if (ids.some((id) => !isId(id))) return { ok: false, error: '入金が見つかりません。画面を開き直してください' };
  if (x.state !== 'not_recital' && x.state !== 'hold' && x.state !== 'void') return { ok: false, error: '記録できませんでした。画面を開き直してください' };
  const memo = x.state === 'hold' && typeof x.memo === 'string' && x.memo.trim() !== '' ? x.memo.trim().slice(0, MEMO_MAX) : null;
  try {
    await setBankRowState(ids, x.state, memo, x.staffName);
  } catch (e) {
    return { ok: false, ...toMessage(e, 'set_state') };
  }
  done();
  return { ok: true };
}

/** 「もとにもどす」（理由が要る。もどした行は自動では当てない・発表会ではないからもどした行の名義は空のまま） */
export async function restoreAction(x: { rowId: number; reason: string; staffName: string }): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  if (!isId(x.rowId)) return { ok: false, error: '入金が見つかりません。画面を開き直してください' };
  if (typeof x.reason !== 'string' || x.reason.trim() === '') return { ok: false, error: 'もどす理由を書いてください' };
  try {
    await restoreBankRow(x.rowId, x.reason.trim().slice(0, REASON_MAX), x.staffName);
  } catch (e) {
    return { ok: false, ...toMessage(e, 'restore') };
  }
  done();
  return { ok: true };
}

/** 「同じ入金にする」（手で打った行と、あとから明細で入った行。メールは出さない） */
export async function mergeManualAction(x: { manualRowId: number; newRowId: number; staffName: string }): Promise<Result> {
  await requireRecitalStaff();
  if (!okName(x?.staffName)) return { ok: false, error: NAME_ERROR };
  if (!isId(x.manualRowId) || !isId(x.newRowId) || x.manualRowId === x.newRowId) return { ok: false, error: '入金が見つかりません。画面を開き直してください' };
  try {
    await mergeManualRow(x.manualRowId, x.newRowId, x.staffName);
  } catch (e) {
    return { ok: false, ...toMessage(e, 'merge_manual') };
  }
  done();
  return { ok: true };
}
