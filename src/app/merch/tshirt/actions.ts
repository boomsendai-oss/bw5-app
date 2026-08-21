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
  createOrder,
  loadOrderByToken,
  resolveTshirtSettings,
  updateOrderByToken,
} from '@/lib/tshirtOrderDb';

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
}

export type SubmitOrderResult =
  | { ok: true; token: string; receipt: OrderReceipt }
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
  return {
    ok: true,
    token,
    receipt: {
      name: validated.name,
      size: validated.size,
      qty: validated.qty,
      wantsShipping: validated.wantsShipping,
      totalAmount: calcOrderTotal(validated.qty, validated.wantsShipping, settings),
    },
  };
}

export type LoadOwnOrderResult =
  | { ok: true; order: OrderInput & { totalAmount: number } }
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
    },
  };
}

export type UpdateOrderResult = { ok: true; receipt: OrderReceipt } | { ok: false; error: string };

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
  if (!ok) return { ok: false, error: 'ご注文が見つかりません' };
  return {
    ok: true,
    receipt: {
      name: validated.name,
      size: validated.size,
      qty: validated.qty,
      wantsShipping: validated.wantsShipping,
      totalAmount: calcOrderTotal(validated.qty, validated.wantsShipping, settings),
    },
  };
}
