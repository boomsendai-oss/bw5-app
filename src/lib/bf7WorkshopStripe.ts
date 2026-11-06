// BF7 HIRO ワークショップのStripe Checkout と銀行振込。通知の受け口はvol.6と共通(/api/bf6/stripe-webhook)。
// ほかの注文と取り違えないよう、metadata は bf7_ws_order_id に入れる(クリパ・vol.7エントリーと同じ相乗り方式)。
// 銀行振込(2026-11-06・TARO): Stripe の customer_balance(jp_bank_transfer)。申込ごとに顧客を作り、その人専用の振込先が発行される。
//   入金が済むと PaymentIntent の payment_intent.succeeded が届く(手数料1.5%・金額が足りないときは足りるまで待つ)。
import { createBf6CheckoutSession, type StripeCheckoutSession } from '@/lib/bf6Stripe';
import type { Bf7WsBankAccount } from '@/lib/bf7Workshop';

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

async function stripePost(path: string, params: URLSearchParams): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any -- Stripeの応答は動的構造
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY が未設定です');
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // エラー詳細はログのみ(顧客には出さない)
    console.error('[bf7ws] stripe', path, 'failed', res.status, body?.error?.code, body?.error?.message);
    throw new Error(`Stripe ${path} failed`);
  }
  return body;
}

const ACCOUNT_TYPE_LABEL: Record<string, string> = { futsu: '普通', toza: '当座' };

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripeの応答は動的構造 */
/** PaymentIntent の next_action から日本の振込先(zengin)を取り出す。無ければ null */
export function parseBf7WsBankAccount(pi: any): Bf7WsBankAccount | null {
  const addrs = pi?.next_action?.display_bank_transfer_instructions?.financial_addresses;
  if (!Array.isArray(addrs)) return null;
  const z = addrs.find((a: any) => a?.type === 'zengin')?.zengin;
  if (!z || !z.account_number || !z.bank_name) return null;
  return {
    bank: String(z.bank_name),
    branch: String(z.branch_name ?? ''),
    type: ACCOUNT_TYPE_LABEL[String(z.account_type)] ?? String(z.account_type ?? ''),
    number: String(z.account_number),
    holder: String(z.account_holder_name ?? ''),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function buildBf7WsBankTransferParams(p: { customerId: string; amount: number; orderId: number; description: string }): URLSearchParams {
  const params = new URLSearchParams();
  params.set('amount', String(p.amount));
  params.set('currency', 'jpy');
  params.set('customer', p.customerId);
  params.set('payment_method_types[]', 'customer_balance');
  params.set('payment_method_data[type]', 'customer_balance');
  params.set('payment_method_options[customer_balance][funding_type]', 'bank_transfer');
  params.set('payment_method_options[customer_balance][bank_transfer][type]', 'jp_bank_transfer');
  params.set('confirm', 'true');
  params.set('description', p.description);
  params.set('metadata[bf7_ws_order_id]', String(p.orderId));
  return params;
}

/** 申込1件ぶんの Stripe 銀行振込を作り、その人専用の振込先を返す。失敗したら throw(呼び出し側で固定の口座に切り替える) */
export async function createBf7WsBankTransfer(p: { orderId: number; amount: number; email: string; name: string; description: string }): Promise<{ paymentIntentId: string; bankAccount: Bf7WsBankAccount }> {
  const c = new URLSearchParams();
  c.set('email', p.email);
  c.set('name', p.name);
  c.set('metadata[bf7_ws_order_id]', String(p.orderId));
  const customer = await stripePost('customers', c);
  const pi = await stripePost('payment_intents', buildBf7WsBankTransferParams({ customerId: String(customer.id), amount: p.amount, orderId: p.orderId, description: p.description }));
  const bankAccount = parseBf7WsBankAccount(pi);
  if (!bankAccount) throw new Error('Stripe の振込先を読み取れませんでした');
  return { paymentIntentId: String(pi.id), bankAccount };
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
    // Checkout Session は amount_total、銀行振込の PaymentIntent は amount_received
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : typeof obj.amount_received === 'number' ? obj.amount_received : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
