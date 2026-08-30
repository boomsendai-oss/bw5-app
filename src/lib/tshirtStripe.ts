// Tシャツ注文のStripe連携(純ロジック・vitest対象)。
// 方式はBF6と同じ: 公式SDKなしのREST + Checkout Session。金額は常にサーバ側で
// DB保存済みの注文から組み立て、クライアント申告額を一切使わない。決済確定はWebhookが正本。
// Webhookは既存の /api/bf6/stripe-webhook に相乗りし、metadata[tshirt_order_id] で識別する
// (kioskが同じ方式で共存している前例に合わせた。Stripeダッシュボードの追加登録が不要)。

export interface TshirtCheckoutLineItem {
  name: string;
  unitAmount: number;
  qty: number;
}

export interface TshirtOrderForCheckout {
  id: number;
  size: string;
  qty: number;
  wantsShipping: boolean;
  unitPrice: number;
  shippingFee: number;
  totalAmount: number;
}

// 明細はDB保存済みの注文時価格から組む(後から設定の価格を変えても過去の注文はずれない)。
export function buildTshirtLineItems(o: TshirtOrderForCheckout): TshirtCheckoutLineItem[] {
  const items: TshirtCheckoutLineItem[] = [
    {
      name: `BOOM オフィシャルTシャツ（黒×黒モデル） ${o.size}サイズ`,
      unitAmount: o.unitPrice,
      qty: o.qty,
    },
  ];
  if (o.wantsShipping) {
    items.push({ name: '郵送料（何枚でも一律）', unitAmount: o.shippingFee, qty: 1 });
  }
  return items;
}

// Checkout Session作成のフォームパラメータ(Stripe APIはform-encoded)。
// BF6と違いメールは集めていないので customer_email は積まない。
export function buildTshirtCheckoutParams(p: {
  lineItems: TshirtCheckoutLineItem[];
  successUrl: string;
  cancelUrl: string;
  orderId: number;
  expiresAtEpochSec?: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('client_reference_id', `tshirt-${p.orderId}`);
  params.set('metadata[tshirt_order_id]', String(p.orderId));
  if (p.expiresAtEpochSec) params.set('expires_at', String(p.expiresAtEpochSec));
  p.lineItems.forEach((item, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'jpy');
    params.set(`line_items[${i}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmount));
    params.set(`line_items[${i}][quantity]`, String(item.qty));
  });
  return params;
}

export interface TshirtWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  paymentIntentId: string;
  orderId: number;
  amountTotal: number | null;
  currency: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
// metadata.tshirt_order_id を持つイベントだけ拾う。BF6(order_id)やkioskのイベントはnull。
export function parseTshirtWebhookEvent(event: any): TshirtWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.tshirt_order_id;
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
