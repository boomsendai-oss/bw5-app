'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 家庭のマイページ（鍵つきURL）から呼ぶため。edit_token の完全一致の1世帯だけを相手にする。
// ほかの世帯の人・中身は返さない。（21・23・15 がこのファイルに足す）
import { updateInstaHandle } from '@/lib/recitalEntryDb';
import { CARD_CHECKING_TEXT, RecitalPayError, startCardPayment, type CardPayResult } from '@/lib/recitalPayDb';

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
