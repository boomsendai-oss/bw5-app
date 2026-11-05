// MOCCHINナンバーのStripe Checkout。作成処理と通知の受け口はvol.6と共通(/api/bf6/stripe-webhook)。
// ほかの注文と取り違えないよう、metadata は mocchin_entry_id / mocchin_step に入れる(クリパ・BF7と同じ相乗り方式)。
import { createBf6CheckoutSession, type StripeCheckoutSession } from '@/lib/bf6Stripe';

/** 決済画面の有効時間(分) */
export const MOCCHIN_CHECKOUT_MINUTES = 30;

export function buildMocchinCheckoutFormParams(p: {
  itemName: string;
  amount: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail: string;
  entryId: number;
  step: number;
  expiresAtEpochSec: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('customer_email', p.customerEmail);
  params.set('client_reference_id', `mocchin-${p.entryId}-${p.step}`);
  params.set('metadata[mocchin_entry_id]', String(p.entryId));
  params.set('metadata[mocchin_step]', String(p.step));
  params.set('expires_at', String(p.expiresAtEpochSec));
  params.set('line_items[0][price_data][currency]', 'jpy');
  params.set('line_items[0][price_data][product_data][name]', p.itemName);
  params.set('line_items[0][price_data][unit_amount]', String(p.amount));
  params.set('line_items[0][quantity]', '1');
  return params;
}

export function createMocchinCheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  return createBf6CheckoutSession(params);
}

export interface MocchinWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  entryId: number;
  step: number;
  amountTotal: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
/** MOCCHINナンバーのイベントだけ取り出す(metadata.mocchin_entry_id があるもの)。それ以外は null。 */
export function parseMocchinWebhookEvent(event: any): MocchinWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const rawId = obj.metadata?.mocchin_entry_id;
  const rawStep = obj.metadata?.mocchin_step;
  if (rawId == null || !/^\d+$/.test(String(rawId))) return null;
  if (rawStep == null || !/^\d+$/.test(String(rawStep))) return null;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    entryId: Number(rawId),
    step: Number(rawStep),
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
