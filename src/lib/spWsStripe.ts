// 特設ワークショップ(/ws/[slug])のStripe Checkout。仕組みは BOOM DOJO(battleStripe.ts)と同じ。
//
// ⚠️ 決済完了の通知(Webhook)はBF6/BF7・DOJOと同じ受け口(/api/bf6/stripe-webhook)に届く。
//    ほかの注文と取り違えないよう、metadata は sp_ws_entry_id に入れる(Stripe側の設定追加は不要)。
import { createBf6CheckoutSession, type StripeCheckoutSession } from '@/lib/bf6Stripe';
import type { SpWsEvent } from '@/lib/spWs';
import type { SpWsEntryRow } from '@/lib/spWsDb';

export type { StripeCheckoutSession };

/** Checkout Session作成のフォームパラメータ。金額は申込時にDBへ保存した amount_total を使う。 */
export function buildSpWsCheckoutFormParams(p: {
  entry: Pick<SpWsEntryRow, 'entryId' | 'name' | 'amountTotal' | 'email' | 'slug'>;
  ev: Pick<SpWsEvent, 'title'>;
  successUrl: string;
  cancelUrl: string;
  expiresAtEpochSec?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('customer_email', p.entry.email);
  params.set('client_reference_id', `spws-${p.entry.entryId}`);
  params.set('metadata[sp_ws_entry_id]', String(p.entry.entryId));
  params.set('metadata[sp_ws_slug]', p.entry.slug);
  if (p.expiresAtEpochSec) params.set('expires_at', String(p.expiresAtEpochSec));
  params.set('line_items[0][price_data][currency]', 'jpy');
  params.set('line_items[0][price_data][product_data][name]', `${p.ev.title} 参加費(${p.entry.name})`);
  params.set('line_items[0][price_data][unit_amount]', String(p.entry.amountTotal));
  params.set('line_items[0][quantity]', '1');
  return params;
}

export function createSpWsCheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  return createBf6CheckoutSession(params);
}

export interface SpWsWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  paymentIntentId: string;
  entryId: number;
  amountTotal: number | null;
  currency: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
/** 特設WSのイベントだけ取り出す(metadata.sp_ws_entry_id があるもの)。それ以外は null。 */
export function parseSpWsWebhookEvent(event: any): SpWsWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.sp_ws_entry_id;
  if (raw == null || !/^\d+$/.test(String(raw))) return null;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : '',
    entryId: Number(raw),
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
    currency: typeof obj.currency === 'string' ? obj.currency : '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
