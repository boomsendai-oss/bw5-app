'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BOOM オフィシャルTシャツの注文フォーム
// src/app/merch/tshirt/page.tsx を、会員・非会員を問わず誰でも使うため。
// PII対策:
//   - 注文を列挙するアクションは提供しない。閲覧はトークン一致の自分の1件のみ
//   - 郵送先の住所・電話は「郵送希望」の注文にしか保存しない(validateOrderInputで落とす)
//   - 氏名・住所・電話はログに出さない
//   - 送信/編集はIP単位でレート制限する
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import {
  acceptanceState,
  calcOrderTotal,
  validateOrderInput,
  type AcceptState,
  type OrderInput,
  type TshirtSettings,
} from '@/lib/tshirtOrder';
import {
  attachStripeSession,
  createOrder,
  loadOrderByToken,
  resolveTshirtSettings,
  updateOrderByToken,
} from '@/lib/tshirtOrderDb';
import { buildTshirtCheckoutParams, buildTshirtLineItems } from '@/lib/tshirtStripe';
import { createBf6CheckoutSession } from '@/lib/bf6Stripe';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export interface PublicOrderView {
  settings: TshirtSettings;
  state: AcceptState;
  today: string;
}

// 公開: 商品情報と受付状態を返す。注文一覧は返さない。
export async function getOrderView(): Promise<PublicOrderView> {
  const settings = await resolveTshirtSettings();
  const today = todayJst();
  return { settings, state: acceptanceState(settings, today), today };
}

export interface OrderReceipt {
  name: string;
  size: string;
  qty: number;
  wantsShipping: boolean;
  totalAmount: number;
  paymentMethod: 'cash' | 'stripe';
  paid: boolean;
}

export type SubmitOrderResult =
  | { ok: true; token: string; receipt: OrderReceipt; checkoutUrl?: string }
  | { ok: false; error: string };

export async function submitOrder(payload: OrderInput): Promise<SubmitOrderResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`tshirt:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const settings = await resolveTshirtSettings();
  const state = acceptanceState(settings, todayJst());
  if (state !== 'open') return { ok: false, error: '現在は受付期間外です' };

  const validated = validateOrderInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };

  const token = await createOrder(validated);
  const receipt: OrderReceipt = {
    name: validated.name,
    size: validated.size,
    qty: validated.qty,
    wantsShipping: validated.wantsShipping,
    totalAmount: calcOrderTotal(validated.qty, validated.wantsShipping, settings),
    paymentMethod: validated.paymentMethod,
    paid: false,
  };
  // カード決済: 注文を保存した上でStripe Checkoutへ誘導する。
  // 決済確定はWebhookが正本(このURLに行かず離脱しても、注文は未払いのまま残り現金でも払える)。
  if (validated.paymentMethod === 'stripe') {
    const url = await startCheckoutForToken(token);
    if (url.ok) return { ok: true, token, receipt, checkoutUrl: url.url };
    // セッション作成に失敗しても注文自体は受かっている。現金扱いで案内する
    return { ok: true, token, receipt: { ...receipt, paymentMethod: 'cash' } };
  }
  return { ok: true, token, receipt };
}

export type TshirtCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

// トークンの持ち主だけが自分の注文の決済を開始できる。金額はDB保存値から組む。
export async function startTshirtCheckout(token: string): Promise<TshirtCheckoutResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`tshirtpay:${ip}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  return startCheckoutForToken(token);
}

async function startCheckoutForToken(token: string): Promise<TshirtCheckoutResult> {
  const o = await loadOrderByToken(token);
  if (!o) return { ok: false, error: 'ご注文が見つかりません' };
  if (o.paid) return { ok: false, error: 'このご注文はお支払い済みです' };
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'bw5-app.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const backUrl = `${proto}://${host}/merch/tshirt?t=${token}`;
  try {
    const params = buildTshirtCheckoutParams({
      lineItems: buildTshirtLineItems(o),
      successUrl: backUrl,
      cancelUrl: backUrl,
      orderId: o.id,
      expiresAtEpochSec: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    const session = await createBf6CheckoutSession(params);
    await attachStripeSession(o.id, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}

export type LoadOwnOrderResult =
  | { ok: true; order: OrderInput & { totalAmount: number; paid: boolean; paymentMethod: 'cash' | 'stripe' } }
  | { ok: false; error: string };

// トークン一致の自分の1件だけ返す。
export async function loadOwnOrder(token: string): Promise<LoadOwnOrderResult> {
  if (!token) return { ok: false, error: 'ご注文が見つかりません' };
  const o = await loadOrderByToken(token);
  if (!o) return { ok: false, error: 'ご注文が見つかりません' };
  return {
    ok: true,
    order: {
      name: o.name,
      size: o.size,
      qty: o.qty,
      wantsShipping: o.wantsShipping,
      address: o.address,
      phone: o.phone,
      totalAmount: o.totalAmount,
      paid: o.paid,
      paymentMethod: o.paymentMethod,
    },
  };
}

export type UpdateOrderResult = { ok: true; receipt: OrderReceipt; checkoutUrl?: string } | { ok: false; error: string };

export async function updateOwnOrder(token: string, payload: OrderInput): Promise<UpdateOrderResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`tshirt:${ip}`, 20, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const settings = await resolveTshirtSettings();
  const state = acceptanceState(settings, todayJst());
  if (state !== 'open') return { ok: false, error: '受付期間が終了したため、変更できません' };

  const validated = validateOrderInput(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };

  const ok = await updateOrderByToken(token, validated);
  if (!ok) return { ok: false, error: 'お支払い済みのご注文は変更できません。変更が必要な場合はスタッフにお声がけください' };
  const receipt: OrderReceipt = {
    name: validated.name,
    size: validated.size,
    qty: validated.qty,
    wantsShipping: validated.wantsShipping,
    totalAmount: calcOrderTotal(validated.qty, validated.wantsShipping, settings),
    paymentMethod: validated.paymentMethod,
    paid: false,
  };
  if (validated.paymentMethod === 'stripe') {
    const url = await startCheckoutForToken(token);
    if (url.ok) return { ok: true, receipt, checkoutUrl: url.url };
  }
  return { ok: true, receipt };
}
