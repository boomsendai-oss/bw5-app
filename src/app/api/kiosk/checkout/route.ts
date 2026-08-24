// ⚠️ 公開API(認証なし)。理由: イベント会場のiPad(/kiosk)がお客さんのセルフ会計で叩くため。
// 金額はサーバ側でDB価格から再計算し、クライアント申告額は使わない(bf6と同じ原則)。
// 悪用対策: 1注文の合計数量上限 + pending仮押さえは5分で自動解放 + IPレート制限。
import { NextRequest, NextResponse } from 'next/server';
import {
  attachKioskStripeSession,
  cancelKioskOrder,
  createKioskStripeOrder,
  KIOSK_HOLD_MINUTES,
  type KioskCartItem,
} from '@/lib/kioskDb';
import { buildKioskCheckoutFormParams, createKioskCheckoutSession } from '@/lib/kioskStripe';
import { checkRateLimit } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';

export const dynamic = 'force-dynamic';

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

function parseItems(body: unknown): KioskCartItem[] | null {
  if (!body || typeof body !== 'object') return null;
  const raw = (body as { items?: unknown }).items;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const items: KioskCartItem[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const productId = Number((r as { productId?: unknown }).productId);
    const qty = Number((r as { qty?: unknown }).qty);
    const rawVariant = (r as { variantId?: unknown }).variantId;
    const variantId = rawVariant == null ? null : Number(rawVariant);
    if (!Number.isInteger(productId) || !Number.isInteger(qty)) return null;
    if (variantId != null && !Number.isInteger(variantId)) return null;
    items.push({ productId, variantId, qty });
  }
  return items;
}

export async function POST(req: NextRequest) {
  if (!(await checkRateLimit(`kioskco:${clientIp(req)}`, 60, 3600))) {
    return NextResponse.json({ error: '操作が多すぎます。しばらくしてからお試しください' }, { status: 429 });
  }

  let items: KioskCartItem[] | null = null;
  try {
    items = parseItems(await req.json());
  } catch {
    /* fallthrough */
  }
  if (!items) return NextResponse.json({ error: 'カートの内容が不正です' }, { status: 400 });

  const created = await createKioskStripeOrder(items);
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 409 });

  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'bw5-app.vercel.app';
  const proto = req.headers.get('x-forwarded-proto') ?? 'https';
  const base = `${proto}://${host}`;

  try {
    const orderItems = await getAll(
      'SELECT product_name, variant_label, unit_price, qty FROM kiosk_order_items WHERE order_id = ?',
      [created.orderId]
    );
    const params = buildKioskCheckoutFormParams({
      items: orderItems.map((i) => ({
        productName: String(i.product_name),
        variantLabel: String(i.variant_label ?? ''),
        unitPrice: Number(i.unit_price),
        qty: Number(i.qty),
      })),
      orderId: created.orderId,
      successUrl: `${base}/kiosk/done`,
      cancelUrl: `${base}/kiosk/cancelled`,
    });
    const session = await createKioskCheckoutSession(params);
    await attachKioskStripeSession(created.orderId, session.id);
    return NextResponse.json({
      orderId: created.orderId,
      amountTotal: created.amountTotal,
      checkoutUrl: session.url,
      holdSeconds: KIOSK_HOLD_MINUTES * 60,
    });
  } catch (e) {
    // Checkout Sessionを作れなかったら仮押さえを解放して現金誘導に倒す
    await cancelKioskOrder(created.orderId);
    const msg = e instanceof Error ? e.message : '決済ページの作成に失敗しました。現金でのお支払いをお願いします';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
