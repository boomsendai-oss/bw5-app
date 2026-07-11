// WS O: FAQボット向け公開ナレッジ。is_public=1のFAQ+料金+公開スタジオのみ。
// フィールド選定はbuildKnowledge(ホワイトリスト)に集約。ここにSELECT *を書かない。
import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { buildKnowledge, type FaqRow, type ProductRow, type StudioRow } from '@/lib/faqKnowledge';

export async function GET() {
  const [faqs, products, studios] = await Promise.all([
    getAll('SELECT category, question, answer, is_public FROM faq_entries WHERE is_public = 1 ORDER BY category, sort_order'),
    getAll("SELECT product_type, name, price, category, active FROM hacomono_products WHERE active = 1"),
    getAll('SELECT name, address, access_text, google_map_url, active, is_public FROM studios WHERE active = 1 AND is_public = 1'),
  ]);
  const knowledge = buildKnowledge({
    faqRows: faqs as unknown as FaqRow[],
    productRows: products as unknown as ProductRow[],
    studioRows: studios as unknown as StudioRow[],
  });
  return NextResponse.json(knowledge, {
    headers: { 'Cache-Control': 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600' },
  });
}
