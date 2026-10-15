// パーティー申込のStripe連携(純ロジック・vitest対象)。
// 方式はBF6/Tシャツと同じ: 公式SDKなしのREST + Checkout Session。金額はDB保存済みの
// 注文(申込時の単価スナップショット)から組み立て、クライアント申告額は使わない。
// Webhookは既存の /api/bf6/stripe-webhook に相乗りし、metadata[party_order_id] で識別する。
import { XMAS_EVENT_INFO } from '@/lib/party';

export interface PartyCheckoutLineItem {
  name: string;
  unitAmount: number;
  qty: number;
}

export interface PartyOrderForCheckout {
  kind: 'ticket' | 'entry';
  unitPrice: number;
  peopleCount: number;
  memberCount: number;
  teamName: string;
}

export function buildPartyLineItems(o: PartyOrderForCheckout): PartyCheckoutLineItem[] {
  if (o.kind === 'entry') {
    return [{ name: `ショーケース出演(出演料+入場料) ${o.teamName}`, unitAmount: o.unitPrice, qty: o.memberCount }];
  }
  return [{ name: `${XMAS_EVENT_INFO.title} 入場チケット(前売)`, unitAmount: o.unitPrice, qty: o.peopleCount }];
}

export function buildPartyCheckoutParams(p: {
  lineItems: PartyCheckoutLineItem[];
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
  params.set('client_reference_id', `party-${p.orderId}`);
  params.set('metadata[party_order_id]', String(p.orderId));
  if (p.expiresAtEpochSec) params.set('expires_at', String(p.expiresAtEpochSec));
  p.lineItems.forEach((item, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'jpy');
    params.set(`line_items[${i}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmount));
    params.set(`line_items[${i}][quantity]`, String(item.qty));
  });
  return params;
}

export interface PartyWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  paymentIntentId: string;
  orderId: number;
  amountTotal: number | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
// metadata.party_order_id を持つイベントだけ拾う。BF6/Tシャツ/kioskのイベントは null。
export function parsePartyWebhookEvent(event: any): PartyWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.party_order_id;
  if (raw == null || !/^\d+$/.test(String(raw))) return null;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : '',
    orderId: Number(raw),
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
