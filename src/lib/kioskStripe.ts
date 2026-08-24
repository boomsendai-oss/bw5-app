// kiosk の Stripe 連携。BF6と同じく公式SDKを使わず REST + 署名検証(bf6Stripe再利用)。
// 決済の正本はWebhook。金額は常にサーバ側で組み立て、クライアント申告額を使わない。
// 匿名運用のため customer_email は要求しない(レシートはStripe Checkout画面でお客さんが任意入力)。
// payment_method_types は指定せず、ダッシュボードの設定(カード/PayPay/Apple Pay/Google Pay等)に追従する。
export { verifyStripeSignature } from '@/lib/bf6Stripe';

export interface KioskCheckoutLineItem {
  productName: string;
  variantLabel: string;
  unitPrice: number;
  qty: number;
}

export function buildKioskCheckoutFormParams(p: {
  items: KioskCheckoutLineItem[];
  orderId: number;
  successUrl: string;
  cancelUrl: string;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  params.set('client_reference_id', String(p.orderId));
  params.set('metadata[kiosk_order_id]', String(p.orderId));
  p.items.forEach((item, i) => {
    const name = item.variantLabel ? `${item.productName} (${item.variantLabel})` : item.productName;
    params.set(`line_items[${i}][price_data][currency]`, 'jpy');
    params.set(`line_items[${i}][price_data][product_data][name]`, name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitPrice));
    params.set(`line_items[${i}][quantity]`, String(item.qty));
  });
  return params;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

/** Checkout Sessionを作成しQR化するURLを返す。失敗時はErrorをthrow。 */
export async function createKioskCheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('オンライン決済は現在準備中です(決済設定が未完了)');
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  const body = await res.json();
  if (!res.ok || !body?.url) {
    console.error('[kiosk] checkout session create failed', res.status, body?.error?.code, body?.error?.message);
    throw new Error('決済ページの作成に失敗しました。現金でのお支払いをお願いします');
  }
  return { id: String(body.id), url: String(body.url) };
}

/**
 * QR放置リセット時にCheckout Sessionを能動的に失効させる(遅れて支払われるのを防ぐ)。
 * 失敗しても致命ではない(ローカルはexpired化済み・遅れて入金されればWebhookが回収する)ため
 * booleanで返しthrowしない。
 */
export async function expireKioskCheckoutSession(sessionId: string): Promise<boolean> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !sessionId) return false;
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface KioskWebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  orderId: number | null;
  amountTotal: number | null;
  /** 'paid' | 'unpaid' | 'no_payment_required'。PayPay等の非同期決済では
   *  checkout.session.completed 時点で 'unpaid'(処理中)があり得る。 */
  paymentStatus: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
export function parseKioskWebhookEvent(event: any): KioskWebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const raw = obj.metadata?.kiosk_order_id;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    orderId: raw != null && /^\d+$/.test(String(raw)) ? Number(raw) : null,
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
    paymentStatus: typeof obj.payment_status === 'string' ? obj.payment_status : '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
