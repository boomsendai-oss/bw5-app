// ⚠️ 公開API(認証なし)。理由: iPad(/kiosk)の「現金で支払いました」ボタンが叩くため。
// 売上記録と在庫減のみ(お金の授受は貯金箱)。誤操作はスタッフ画面から取消(void)できる。
import { NextRequest, NextResponse } from 'next/server';
import { createKioskCashOrder, type KioskCartItem } from '@/lib/kioskDb';
import { checkRateLimit } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  if (!(await checkRateLimit(`kioskcash:${ip}`, 60, 3600))) {
    return NextResponse.json({ error: '操作が多すぎます。しばらくしてからお試しください' }, { status: 429 });
  }
  let items: KioskCartItem[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.items)) {
      items = body.items.map((r: { productId: unknown; variantId?: unknown; qty: unknown }) => ({
        productId: Number(r.productId),
        variantId: r.variantId == null ? null : Number(r.variantId),
        qty: Number(r.qty),
      }));
    }
  } catch {
    /* fallthrough */
  }
  if (items.length === 0 || items.some((i) => !Number.isInteger(i.productId) || !Number.isInteger(i.qty))) {
    return NextResponse.json({ error: 'カートの内容が不正です' }, { status: 400 });
  }
  const res = await createKioskCashOrder(items);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 409 });
  return NextResponse.json({ orderId: res.orderId, amountTotal: res.amountTotal });
}
