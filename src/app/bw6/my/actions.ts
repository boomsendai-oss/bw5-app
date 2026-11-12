'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 家庭のマイページ（鍵つきURL）から呼ぶため。edit_token の完全一致の1世帯だけを相手にする。
// ほかの世帯の人・中身は返さない。（21・23・15 がこのファイルに足す。23＝銀行振込を選ぶ・「振り込みました」）
import { updateInstaHandle } from '@/lib/recitalEntryDb';
import { requireHouseholdByToken } from '@/lib/recitalGuard';
import { parseYenInput } from '@/lib/recitalMyPage';
import {
  BANK_TOLD_NAME_MAX, CARD_CHECKING_TEXT, RecitalPayError, chooseBankTransfer, markBankTold, startCardPayment, type BankChooseResult, type CardPayResult,
} from '@/lib/recitalPayDb';

/** インスタの欄を変える。確かめ（鍵・その世帯の人か・100字・止めている間）は updateInstaHandle の中 */
export async function updateInstaAction(token: string, personId: number, handle: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string' || !Number.isInteger(personId) || typeof handle !== 'string') return { ok: false };
  return updateInstaHandle(token, personId, handle);
}

// 家庭の画面にそのまま出してよい失敗の文（ほかの失敗は「もう一度押してください」にする。中身はログだけ）
const SHOWABLE_ERRORS = new Set(['カード決済は、準備中です', '決済ページの作成に失敗しました。時間をおいてお試しください']);

/**
 * 「カードで払う」（Task 21）。金額は家庭から受けない（サーバでその時の今の残りから出す）。
 * 決済の画面へ進む時は { url }、1回止める時は { blocked }、うまくいかない時は { error }（throw しない）。
 */
export async function payByCardAction(
  token: string,
  opts: { confirmNotBank?: boolean; confirmTold?: boolean },
): Promise<CardPayResult | { error: string }> {
  if (typeof token !== 'string') return { error: 'お申し込みが見つかりません' };
  const o = opts && typeof opts === 'object' ? opts : {};
  try {
    return await startCardPayment(token, { confirmNotBank: o.confirmNotBank === true, confirmTold: o.confirmTold === true });
  } catch (e) {
    if (e instanceof RecitalPayError) return { error: e.message };
    const msg = e instanceof Error ? e.message : String(e);
    if (SHOWABLE_ERRORS.has(msg)) return { error: msg };
    // Stripe に聞けなかった時は、2回払わせないよう「確認しています」を出す（R-98）
    if (msg === 'recital_stripe:retrieve_failed' || msg === 'recital_pay:no_amount') return { error: CARD_CHECKING_TEXT };
    console.error('[recital] カードで払うに失敗しました', msg);
    return { error: 'もう一度押してください' };
  }
}

/**
 * 「払う」で銀行振込を選ぶ（Task 23）。決まり（鍵・bank_text・残り）は chooseBankTransfer の中。
 * 選べた時は { ok: true }、選べない時は { blocked }、うまくいかない時は { error }（throw しない）。
 */
export async function chooseBankAction(token: string): Promise<BankChooseResult | { error: string }> {
  if (typeof token !== 'string') return { error: 'お申し込みが見つかりません' };
  try {
    return await chooseBankTransfer(token);
  } catch (e) {
    if (e instanceof RecitalPayError) return { error: e.message };
    console.error('[recital] 銀行振込を選べませんでした', e instanceof Error ? e.message : String(e));
    return { error: 'もう一度押してください' };
  }
}

const TOLD_ERRORS = {
  future: 'お振込みの日に、今日より先の日は入れられません。',
  nothing_due: 'お支払いの残りはありません。',
} as const;

/**
 * 「振り込みました」（Task 23・D5 2-20）。金額は欄の字を parseYenInput で数にする。鍵の世帯にだけ印を付ける（by=family）。
 * 形のおかしい入力・有効でない世帯は { error }（エラーの画面にしない）。名前・金額はログに出さない。
 */
export async function markBankToldAction(
  token: string,
  x: { date: string; name: string; amount: string },
): Promise<{ ok: true } | { error: string }> {
  if (typeof token !== 'string' || !x || typeof x !== 'object') return { error: '入力を確かめてください。' };
  if (typeof x.date !== 'string' || typeof x.name !== 'string' || typeof x.amount !== 'string') return { error: '入力を確かめてください。' };
  if ([...x.name.trim()].length > BANK_TOLD_NAME_MAX) return { error: '入力を確かめてください。' };
  const amount = parseYenInput(x.amount);
  if (amount == null) return { error: '金額を確かめてください。' };
  const d = await requireHouseholdByToken(token);
  if (!d || d.household.status !== 'active') return { error: 'お申し込みが見つかりません' };
  try {
    const r = await markBankTold(Number(d.household.id), { date: x.date, name: x.name, amount }, 'family', 'family');
    if (r.ok) return { ok: true };
    return { error: r.code ? TOLD_ERRORS[r.code] : '入力を確かめてください。' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== 'recital_pay:bad_input') console.error(`[recital] 振り込みましたの印を付けられませんでした household=${d.household.id}`, msg);
    return { error: '入力を確かめてください。' };
  }
}
