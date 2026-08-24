// ⚠️ 公開API(認証なし)。理由: イベント会場のiPad(/kiosk)が販売中の商品一覧を表示するため。
// 返すのは商品情報(名前・価格・写真・販売可能数)のみで個人情報を含まない。
import { NextResponse } from 'next/server';
import { getActiveKioskSale, getKioskCatalog } from '@/lib/kioskDb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sale = await getActiveKioskSale();
    if (!sale) return NextResponse.json({ sale: null, products: [] });
    const products = (await getKioskCatalog(sale.id)).filter((p) => p.active);
    return NextResponse.json({ sale: { id: sale.id, name: sale.name, eventDate: sale.eventDate }, products });
  } catch (e) {
    console.error('[kiosk] catalog failed', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: '商品一覧の取得に失敗しました' }, { status: 500 });
  }
}
