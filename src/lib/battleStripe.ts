// 月1回の校内プチバトル(/dojo)のStripe Checkout。仕組みはBF7(bf7Stripe.ts)と同じ。
//
// ⚠️ 決済完了の通知(Webhook)はBF6/BF7と同じ受け口(/api/bf6/stripe-webhook)に届く。
//    ほかの注文と取り違えないよう、metadata は battle_entry_id に入れる(Stripe側の設定追加は不要)。
import { createBf6CheckoutSession, type Bf6CheckoutLineItem, type StripeCheckoutSession } from '@/lib/bf6Stripe';
import type { BattleEvent } from '@/lib/battle';
import type { BattleEntryRow } from '@/lib/battleDb';

export type { StripeCheckoutSession };

/** 申込をStripeのline_items(表示名つき)へ。金額は申込時にDBへ保存した単価を使う。 */
export function buildBattleLineItems(entry: BattleEntryRow, ev: BattleEvent): Bf6CheckoutLineItem[] {
  const items: Bf6CheckoutLineItem[] = entry.divisions.map((k) => ({
    name: `${ev.title} エントリー ${ev.divisions.find((d) => d.key === k)?.name ?? k}(${entry.dancerName})`,
    unitAmount: entry.entryUnit,
    qty: 1,
  }));
  if (entry.spectators > 0 && entry.spectatorUnit > 0) {
    items.push({ name: `${ev.title} 観覧`, unitAmount: entry.spectatorUnit, qty: entry.spectators });
  }
  return items;
}

/** Checkout Session作成のフォームパラメータ。metadata は battle_entry_id(order_id は使わない)。 */
export function buildBattleCheckoutFormParams(p: {
  lineItems: Bf6CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  entryId: number;
  eventKey: string;
  expiresAtEpochSec?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('customer_email', p.customerEmail);
  params.set('client_reference_id', `battle-${p.entryId}`);
  params.set('metadata[battle_entry_id]', String(p.entryId));
  params.set('metadata[battle_event_key]', p.eventKey);
  if (p.expiresAtEpochSec) params.set('expires_at', String(p.expiresAtEpochSec));
  p.lineItems.forEach((item, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'jpy');
    params.set(`line_items[${i}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmount));
    params.set(`line_items[${i}][quantity]`, String(item.qty));
  });
  return params;
}

/** Checkout Sessionを作成する(作成処理そのものはBF6と共通)。 */
export function createBattleCheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  return createBf6CheckoutSession(params);
}

export interface BattleWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  paymentIntentId: string;
  entryId: number;
  amountTotal: number | null;
  currency: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
/** プチバトルのイベントだけ取り出す(metadata.battle_entry_id があるもの)。それ以外は null。 */
export function parseBattleWebhookEvent(event: any): BattleWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.battle_entry_id;
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
