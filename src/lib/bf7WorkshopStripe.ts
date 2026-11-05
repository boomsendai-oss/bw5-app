// BF7 HIRO ワークショップのStripe Checkout。作成処理と通知の受け口はvol.6と共通(/api/bf6/stripe-webhook)。
// ほかの注文と取り違えないよう、metadata は bf7_ws_order_id に入れる(クリパ・vol.7エントリーと同じ相乗り方式)。
import { createBf6CheckoutSession, type StripeCheckoutSession } from '@/lib/bf6Stripe';

export function buildBf7WsCheckoutFormParams(p: {
  itemName: string;
  amount: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  orderId: number;
  expiresAtEpochSec: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('customer_email', p.customerEmail);
  params.set('client_reference_id', `bf7ws-${p.orderId}`);
  params.set('metadata[bf7_ws_order_id]', String(p.orderId));
  params.set('expires_at', String(p.expiresAtEpochSec));
  params.set('line_items[0][price_data][currency]', 'jpy');
  params.set('line_items[0][price_data][product_data][name]', p.itemName);
  params.set('line_items[0][price_data][unit_amount]', String(p.amount));
  params.set('line_items[0][quantity]', '1');
  return params;
}

export function createBf7WsCheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  return createBf6CheckoutSession(params);
}

export interface Bf7WsWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  orderId: number;
  amountTotal: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
/** WSの注文のイベントだけ取り出す(metadata.bf7_ws_order_id があるもの)。それ以外は null。 */
export function parseBf7WsWebhookEvent(event: any): Bf7WsWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.bf7_ws_order_id;
  if (raw == null || !/^\d+$/.test(String(raw))) return null;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    orderId: Number(raw),
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
