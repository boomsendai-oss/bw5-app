// WS O: FAQボット向け公開ナレッジ。is_public=1のFAQ+料金+公開スタジオのみ。
// フィールド選定はbuildKnowledge(ホワイトリスト)に集約。ここにSELECT *を書かない。
import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { buildKnowledge, type FaqRow, type ProductRow, type StudioRow, type PublicKnowledge } from '@/lib/faqKnowledge';

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600' };

// I-1: ?_=乱数 等のキャッシュバスティングでCDNキャッシュをすり抜けられても、
// インスタンス内TTLキャッシュによりDBクエリは10分に1回まで(公開・無認証のDoS対策)。
// force-staticはビルド時にDB接続を要求するリスクがあるため不採用。
const TTL_MS = 600_000;
let cached: { at: number; body: PublicKnowledge } | null = null;

export async function GET() {
  if (cached && Date.now() - cached.at < TTL_MS) {
    return NextResponse.json(cached.body, { headers: CACHE_HEADERS });
  }
  try {
    const [faqs, products, studios] = await Promise.all([
      getAll('SELECT category, question, answer, is_public FROM faq_entries WHERE is_public = 1 ORDER BY category, sort_order'),
      getAll(
        "SELECT product_type, name, price, category, active FROM hacomono_products WHERE active = 1 AND (category IS NULL OR category NOT IN ('admin','instructor','pause'))"
      ),
      getAll('SELECT name, address, access_text, google_map_url, active, is_public FROM studios WHERE active = 1 AND is_public = 1'),
    ]);
    const knowledge = buildKnowledge({
      faqRows: faqs as unknown as FaqRow[],
      productRows: products as unknown as ProductRow[],
      studioRows: studios as unknown as StudioRow[],
    });
    cached = { at: Date.now(), body: knowledge };
    return NextResponse.json(knowledge, { headers: CACHE_HEADERS });
  } catch (e) {
    console.error('[public/knowledge]', e);
    // 公開・無認証のため内部情報は返さない。エラー応答にキャッシュヘッダは付けない。
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
