import { NextResponse } from 'next/server';
import { fetchItems, isAuthorized, buildItemUrl } from '@/lib/base';

// 5分キャッシュ — 在庫の即時反映ではなく体感速度を優先
// 価格や在庫の変更も最大5分で反映される
export const revalidate = 300;

const SHOP_URL = process.env.BASE_SHOP_URL || 'https://nitroash.thebase.in';

// シンプルなインメモリキャッシュ（ホットなレスポンスを即返す）
let cache: { data: unknown; expires: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5分

// GET /api/base-products — 公開用：BASEショップの商品リスト
export async function GET() {
  try {
    // インメモリキャッシュ ヒット
    if (cache && cache.expires > Date.now()) {
      return NextResponse.json(cache.data, {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
        },
      });
    }

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
        const price = it.price ?? 0;
        const properPrice = it.proper_price ?? 0;
        const onSale = properPrice > 0 && properPrice > price;
        return {
          item_id: it.item_id,
          title: it.title,
          price,
          proper_price: properPrice || null,
          on_sale: onSale,
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

    const responseData = { products, count: products.length };
    cache = { data: responseData, expires: Date.now() + CACHE_TTL_MS };
    return NextResponse.json(responseData, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown';
    console.error('[base-products] err', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
