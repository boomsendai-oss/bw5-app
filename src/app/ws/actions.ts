'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: 特設ワークショップは会員以外も申し込める公開イベントで、
// /ws/[slug] の公開フォームが叩くため(BOOM DOJO の dojo/actions.ts と同じ守り)。
// - 送信はIP単位のレート制限。金額は必ずサーバ側で再計算する(クライアント申告額は使わない)
// - 名前・電話・メール・年齢を返す公開経路は作らない。個別閲覧は edit_token 完全一致の1件のみ
// - 確認用モード: 受付していない間でも、スタッフのログイン中(isAuthorizedServer=サーバ側で検証)なら
//   申込を通す。ただし「テスト」として保存し、決済しない・定員に数えない
import { headers } from 'next/headers';
import { checkRateLimit, isAuthorizedServer } from '@/lib/eventAuth';
import { nowJstMinute, spWsGateError, validateSpWsEntry, type SpWsEntryInput } from '@/lib/spWs';
import { createSpWsEntry, getSpWsEvent, getSpWsRemaining, loadSpWsEntryByToken, saveSpWsStripeSession } from '@/lib/spWsDb';
import { buildSpWsCheckoutFormParams, createSpWsCheckoutSession } from '@/lib/spWsStripe';
import { sendSpWsConfirmEmail } from '@/lib/spWsEmail';
import { FALLBACK_HOST } from '@/lib/appOrigin';

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

export type SpWsSubmitResult =
  | { ok: true; token: string; status: 'pending' | 'paid' | 'onsite' | 'test'; amountTotal: number }
  | { ok: false; error: string };

export async function submitSpWsEntry(slug: string, input: Partial<Omit<SpWsEntryInput, 'age'>> & { age?: unknown }): Promise<SpWsSubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`spws:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const ev = await getSpWsEvent(String(slug ?? ''));
  if (!ev) return { ok: false, error: 'ワークショップが見つかりません。ページを読み込み直してください' };
  const now = nowJstMinute();
  const remaining = await getSpWsRemaining(ev);
  const gateError = spWsGateError(ev, now, remaining);
  const staffTest = Boolean(gateError) && (await isAuthorizedServer());
  if (gateError && !staffTest) return { ok: false, error: gateError };

  const v = validateSpWsEntry(input);
  if (typeof v === 'string') return { ok: false, error: v };

  const created = await createSpWsEntry(ev, v, { test: staffTest });
  if (!created.ok) return { ok: false, error: created.error };
  if (created.status === 'paid' || created.status === 'onsite') {
    // 当日払い・0円は決済なしで確定=ここで確定メールを送る(カードはWebhookで決済確定時)
    const entry = await loadSpWsEntryByToken(created.editToken);
    if (entry) await sendSpWsConfirmEmail(entry, created.editToken, ev);
  }
  return { ok: true, token: created.editToken, status: created.status, amountTotal: created.amountTotal };
}

export type SpWsCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Stripe Checkoutへ。金額はDBに保存済みの申込から組み立てる。確定はWebhookが正本。 */
export async function startSpWsCheckout(token: string): Promise<SpWsCheckoutResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`spwspay:${ip}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const entry = token ? await loadSpWsEntryByToken(String(token)) : null;
  if (!entry) return { ok: false, error: 'お申し込みが見つかりません' };
  if (entry.paymentStatus === 'paid') return { ok: false, error: 'このお申し込みはお支払い済みです' };
  if (entry.paymentStatus === 'expired') {
    return { ok: false, error: '30分以内に決済が完了しなかったため、このお申し込みは無効になりました。お手数ですがもう一度お申し込みください' };
  }
  if (entry.paymentStatus !== 'pending') return { ok: false, error: 'このお申し込みはカード決済の対象ではありません' };
  const ev = await getSpWsEvent(entry.slug);
  if (!ev) return { ok: false, error: 'ワークショップが見つかりません' };

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? FALLBACK_HOST;
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const completeUrl = `${proto}://${host}/ws/complete?t=${token}`;
  try {
    const params = buildSpWsCheckoutFormParams({
      entry,
      ev,
      successUrl: completeUrl,
      cancelUrl: completeUrl,
      // 30分の仮押さえと同じ長さ(Stripeの下限が30分)
      expiresAtEpochSec: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    const session = await createSpWsCheckoutSession(params);
    await saveSpWsStripeSession(entry.entryId, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}
