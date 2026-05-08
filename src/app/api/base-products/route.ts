import { NextResponse } from 'next/server';
import { fetchItems, isAuthorized, buildItemUrl } from '@/lib/base';

export const dynamic = 'force-dynamic';

const SHOP_URL = process.env.BASE_SHOP_URL || 'https://nitroash.thebase.in';

// GET /api/base-products — 公開用：BASEショップの商品リスト
export async function GET() {
  try {
    const authed = await isAuthorized();
    if (!authed) {
      return NextResponse.json(
        { error: 'BASE not authorized', authorize_url: '/api/base-auth' },
        { status: 503 }
      );
    }

    const items = await fetchItems({ limit: 50 });

    // フロント表示用に整形
    const products = items
      .filter((it) => it.visible !== 0) // 非公開除外
      .map((it) => {
        const stock =
          typeof it.stock === 'number'
            ? it.stock
            : it.variations
            ? it.variations.reduce((s, v) => s + (v.variation_stock ?? 0), 0)
            : 0;
        return {
          item_id: it.item_id,
          title: it.title,
          price: it.price ?? 0,
          stock,
          sold_out: stock <= 0,
          image_url:
            it.list_image_url ||
            it.img1_origin ||
            it.detail_image_url ||
            '',
          url: buildItemUrl(SHOP_URL, it.item_id),
          variations:
            it.variations?.map((v) => ({
              id: v.variation_id,
              name: v.variation,
              stock: v.variation_stock,
            })) ?? [],
        };
      });

    return NextResponse.json({ products, count: products.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[base-products] err', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
