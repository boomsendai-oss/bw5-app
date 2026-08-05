// BF6のStripe連携。公式SDKは使わず REST + Web/Node crypto で実装する
// (依存追加を避ける・Checkout Session作成とWebhook署名検証しか使わないため)。
// 決済の正本はWebhook: 金額は常にサーバ側で組み立て、クライアント申告額を使わない。
import { createHmac, timingSafeEqual } from 'node:crypto';
import { bf6DivisionLabel } from '@/lib/bf6';
import type { OwnBf6Order } from '@/lib/bf6Db';

/**
 * Stripe-Signature ヘッダの検証。`t=<epoch>,v1=<hmac>` 形式で、
 * HMAC-SHA256(secret, `${t}.${payload}`) が v1 のいずれかと一致し、
 * かつ t が許容範囲内(リプレイ防止)であること。
 */
export function verifyStripeSignature(
  payload: string,
  sigHeader: string | null,
  secret: string,
  toleranceSec = 300,
  nowMs: number = Date.now()
): boolean {
  if (!sigHeader) return false;
  const parts = sigHeader.split(',').map((p) => p.trim());
  const t = parts.find((p) => p.startsWith('t='))?.slice(2) ?? '';
  const v1s = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  if (!/^\d+$/.test(t) || v1s.length === 0) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');
  return v1s.some((v) => {
    const buf = Buffer.from(v, 'utf8');
    return buf.length === expectedBuf.length && timingSafeEqual(buf, expectedBuf);
  });
}

export interface Bf6CheckoutLineItem {
  name: string;
  unitAmount: number;
  qty: number;
}

/** 注文明細をStripeのline_items(表示名つき)へ。 */
export function buildBf6LineItems(order: OwnBf6Order): Bf6CheckoutLineItem[] {
  return order.items.map((i) => {
    if (i.itemType === 'entry') {
      return {
        name: `バトルエントリー ${i.dancerName}(${i.divisions.length}部門)`,
        unitAmount: i.unitAmount,
        qty: i.qty,
      };
    }
    if (i.itemType === 'ticket_adult') {
      return { name: '観覧チケット(大人)', unitAmount: i.unitAmount, qty: i.qty };
    }
    if (i.itemType === 'ticket_child') {
      return { name: '観覧チケット(小学生)', unitAmount: i.unitAmount, qty: i.qty };
    }
    if (i.itemType === 'stream') {
      return { name: 'オンライン配信視聴チケット', unitAmount: i.unitAmount, qty: i.qty };
    }
    return { name: i.itemType, unitAmount: i.unitAmount, qty: i.qty };
  });
}

/** Checkout Session作成のフォームパラメータ(Stripe APIはform-encoded)。 */
export function buildCheckoutFormParams(p: {
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
  params.set('client_reference_id', String(p.orderId));
  params.set('metadata[order_id]', String(p.orderId));
  if (p.expiresAtEpochSec) params.set('expires_at', String(p.expiresAtEpochSec));
  p.lineItems.forEach((item, i) => {
    params.set(`line_items[${i}][price_data][currency]`, 'jpy');
    params.set(`line_items[${i}][price_data][product_data][name]`, item.name);
    params.set(`line_items[${i}][price_data][unit_amount]`, String(item.unitAmount));
    params.set(`line_items[${i}][quantity]`, String(item.qty));
  });
  return params;
}

export interface StripeCheckoutSession {
  id: string;
  url: string;
}

/** Checkout Sessionを作成しリダイレクト先URLを返す。失敗時はErrorをthrow。 */
export async function createBf6CheckoutSession(params: URLSearchParams): Promise<StripeCheckoutSession> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('カード決済は現在準備中です(決済設定が未完了)');
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
    // Stripeのエラー詳細はログのみ(顧客には出さない)。金額・PIIは含まれない想定
    console.error('[bf6] checkout session create failed', res.status, body?.error?.code, body?.error?.message);
    throw new Error('決済ページの作成に失敗しました。時間をおいてお試しください');
  }
  return { id: String(body.id), url: String(body.url) };
}

/** Webhookイベント(検証済みJSON)から必要最小限を取り出す。 */
export interface Bf6WebhookEvent {
  eventId: string;
  type: string;
  sessionId: string;
  paymentIntentId: string;
  orderId: number | null;
  amountTotal: number | null;
  currency: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeイベントは動的構造 */
export function parseBf6WebhookEvent(event: any): Bf6WebhookEvent | null {
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') return null;
  const obj = event.data?.object ?? {};
  const rawOrderId = obj.metadata?.order_id;
  return {
    eventId: event.id,
    type: event.type,
    sessionId: typeof obj.id === 'string' ? obj.id : '',
    paymentIntentId: typeof obj.payment_intent === 'string' ? obj.payment_intent : '',
    orderId: rawOrderId != null && /^\d+$/.test(String(rawOrderId)) ? Number(rawOrderId) : null,
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
    currency: typeof obj.currency === 'string' ? obj.currency : '',
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export { bf6DivisionLabel };
