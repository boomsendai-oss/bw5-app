// BOOMER'S FIGHT!!! vol.7 のStripe Checkout。仕組みはvol.6(bf6Stripe.ts)と同じ。
//
// ⚠️ 決済完了の通知(Webhook)はvol.6と同じ受け口(/api/bf6/stripe-webhook)に届く。
//    vol.6の注文と取り違えないよう、metadata は order_id ではなく bf7_order_id に入れる
//    (クリスマスパーティーの party_order_id と同じ相乗り方式。Stripe側の設定追加は不要)。
import { createBf6CheckoutSession, type Bf6CheckoutLineItem, type StripeCheckoutSession } from '@/lib/bf6Stripe';
import type { OwnBf7Order } from '@/lib/bf7EntryDb';

export type { StripeCheckoutSession };

/** 注文明細をStripeのline_items(表示名つき)へ。 */
export function buildBf7LineItems(order: OwnBf7Order): Bf6CheckoutLineItem[] {
  return order.items.map((i) => {
    if (i.itemType === 'entry') {
      return { name: `vol.7 バトルエントリー ${i.dancerName}(${i.divisions.length}部門)`, unitAmount: i.unitAmount, qty: i.qty };
    }
    if (i.itemType === 'ticket_adult') return { name: 'vol.7 観覧チケット(大人)', unitAmount: i.unitAmount, qty: i.qty };
    if (i.itemType === 'ticket_child') return { name: 'vol.7 観覧チケット(小学生)', unitAmount: i.unitAmount, qty: i.qty };
    if (i.itemType === 'stream') return { name: 'vol.7 オンライン配信視聴チケット', unitAmount: i.unitAmount, qty: i.qty };
    return { name: i.itemType, unitAmount: i.unitAmount, qty: i.qty };
  });
}

/** Checkout Session作成のフォームパラメータ。metadata は bf7_order_id(order_id は使わない)。 */
export function buildBf7CheckoutFormParams(p: {
  lineItems: Bf6CheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  orderId: number;
  expiresAtEpochSec?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('customer_email', p.customerEmail);
  params.set('client_reference_id', `bf7-${p.orderId}`);
  params.set('metadata[bf7_order_id]', String(p.orderId));
  if (p.expiresAtEpochSec) params.set('expires_at', String(p.expiresAtEpochSec));
  p.lineItems.forEach((item, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'jpy');
    params.set(`line_items[${i}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmount));
    params.set(`line_items[${i}][quantity]`, String(item.qty));
  });
  return params;
}

/** Checkout Sessionを作成する(作成処理そのものはvol.6と共通)。 */
export function createBf7CheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  return createBf6CheckoutSession(params);
}

export interface Bf7WebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  paymentIntentId: string;
  orderId: number;
  amountTotal: number | null;
  currency: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
/** vol.7の注文のイベントだけ取り出す(metadata.bf7_order_id があるもの)。それ以外は null。 */
export function parseBf7WebhookEvent(event: any): Bf7WebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.bf7_order_id;
  if (raw == null || !/^\d+$/.test(String(raw))) return null;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : '',
    orderId: Number(raw),
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
    currency: typeof obj.currency === 'string' ? obj.currency : '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
