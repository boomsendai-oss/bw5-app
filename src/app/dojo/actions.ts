'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 月1回の校内プチバトルは会員以外も申し込める公開イベントで、
// /dojo の公開フォームが叩くため(BF7の order-actions.ts と同じ)。
// - 送信はIP単位のレート制限。金額は必ずサーバ側で再計算する(クライアント申告額は使わない)
// - 本名・電話・メール・年齢を返す公開経路は作らない。個別閲覧は edit_token 完全一致の1件のみ
// - 確認用モード: 受付していない間でも、スタッフのログイン中(isAuthorizedServer=サーバ側で検証)なら
//   申込を通す。ただし「テスト」として保存し、決済しない・定員と公開一覧に数えない
import { headers } from 'next/headers';
import { checkRateLimit, isAuthorizedServer } from '@/lib/eventAuth';
import { battleGateError, nowJstMinute, validateBattleEntry, type BattleEntryInput } from '@/lib/battle';
import {
  createBattleEntry,
  getBattleEvent,
  loadBattleEntryByToken,
  saveBattleStripeSession,
} from '@/lib/battleDb';
import { buildBattleCheckoutFormParams, buildBattleLineItems, createBattleCheckoutSession } from '@/lib/battleStripe';
import { sendBattleConfirmEmail } from '@/lib/battleEmail';
import { FALLBACK_HOST } from '@/lib/appOrigin';

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

export type BattleSubmitResult =
  | { ok: true; token: string; status: 'pending' | 'paid' | 'onsite' | 'test'; amountTotal: number }
  | { ok: false; error: string };

export async function submitBattleEntry(eventKey: string, input: Partial<BattleEntryInput>): Promise<BattleSubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`battle:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const ev = await getBattleEvent(String(eventKey ?? ''));
  if (!ev) return { ok: false, error: 'イベントが見つかりません。ページを読み込み直してください' };
  const now = nowJstMinute();
  const gateError = battleGateError(ev, now);
  const staffTest = Boolean(gateError) && (await isAuthorizedServer());
  if (gateError && !staffTest) return { ok: false, error: gateError };

  const v = validateBattleEntry(input, ev);
  if (typeof v === 'string') return { ok: false, error: v };

  const created = await createBattleEntry(ev, v, now, { test: staffTest });
  if (!created.ok) return { ok: false, error: created.error };
  if (created.status === 'paid' || created.status === 'onsite') {
    // 0円・当日払いの申込は決済なしで確定=ここで確定メールを送る(カードはWebhookで決済確定時)
    const entry = await loadBattleEntryByToken(created.editToken);
    if (entry) await sendBattleConfirmEmail(entry, created.editToken, ev);
  }
  return { ok: true, token: created.editToken, status: created.status, amountTotal: created.amountTotal };
}

export type BattleCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Stripe Checkoutへの遷移。金額・明細はDBに保存済みの申込からサーバ側で組み立てる。
 * 決済確定はWebhook側が正本。
 */
export async function startBattleCheckout(token: string): Promise<BattleCheckoutResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`battlepay:${ip}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const entry = token ? await loadBattleEntryByToken(token) : null;
  if (!entry) return { ok: false, error: '申込が見つかりません' };
  if (entry.paymentStatus === 'paid') return { ok: false, error: 'この申込はお支払い済みです' };
  if (entry.paymentStatus === 'expired') {
    return { ok: false, error: '30分以内に決済が完了しなかったため、この申込は無効になりました。お手数ですがもう一度お申し込みください' };
  }
  if (entry.paymentStatus !== 'pending') return { ok: false, error: 'この申込はカード決済の対象ではありません' };
  const ev = await getBattleEvent(entry.eventKey);
  if (!ev) return { ok: false, error: 'イベントが見つかりません' };

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? FALLBACK_HOST;
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const completeUrl = `${proto}://${host}/dojo/complete?t=${token}`;

  try {
    const params = buildBattleCheckoutFormParams({
      lineItems: buildBattleLineItems(entry, ev),
      successUrl: completeUrl,
      cancelUrl: completeUrl,
      customerEmail: entry.email,
      entryId: entry.entryId,
      eventKey: entry.eventKey,
      // 30分の仮押さえと同じ長さ(Stripeの下限が30分)
      expiresAtEpochSec: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    const session = await createBattleCheckoutSession(params);
    await saveBattleStripeSession(entry.entryId, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}
