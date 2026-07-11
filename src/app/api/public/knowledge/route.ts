// WS O: FAQボット向け公開ナレッジ。is_public=1のFAQ+料金+公開スタジオ+公開インストラクター+公開クラスのみ。
// フィールド選定はbuildKnowledge(ホワイトリスト)に集約。ここにSELECT *を書かない。
import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import {
  buildKnowledge,
  type FaqRow,
  type ProductRow,
  type StudioRow,
  type InstructorRow,
  type ClassRow,
  type PublicKnowledge,
} from '@/lib/faqKnowledge';

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
    const [faqs, products, studios, instructors, classes] = await Promise.all([
      getAll('SELECT category, question, answer, is_public FROM faq_entries WHERE is_public = 1 ORDER BY category, sort_order'),
      getAll(
        "SELECT product_type, name, price, category, active FROM hacomono_products WHERE active = 1 AND (category IS NULL OR category NOT IN ('admin','instructor','pause'))"
      ),
      getAll('SELECT name, address, access_text, google_map_url, active, is_public FROM studios WHERE active = 1 AND is_public = 1'),
      // boom-hp/src/lib/instructors.ts と同一の公開条件・ソート順。給与/連絡先/銀行口座系の列は選択しない。
      getAll(
        "SELECT name, genre, active, slug FROM instructors WHERE active = 1 AND slug IS NOT NULL AND slug != '' ORDER BY COALESCE(public_display_order, 999), id"
      ),
      // boom-hp/src/lib/classes.ts と同一の公開条件・JOIN・ソート順。notesは内部メモ(HP自身も非表示)のため選択しない。
      getAll(`
        SELECT lm.class_name, lm.level, lm.default_day_of_week, lm.default_start_time, lm.default_end_time,
               lm.active, lm.is_public, s.name AS studio_name, i.name AS instructor_name
        FROM lesson_master lm
        LEFT JOIN studios s ON s.id = lm.default_studio_id
        LEFT JOIN instructors i ON i.id = lm.default_instructor_id
        WHERE lm.active = 1 AND lm.is_public = 1
        ORDER BY lm.default_day_of_week, lm.default_start_time
      `),
    ]);
    const knowledge = buildKnowledge({
      faqRows: faqs as unknown as FaqRow[],
      productRows: products as unknown as ProductRow[],
      studioRows: studios as unknown as StudioRow[],
      instructorRows: instructors as unknown as InstructorRow[],
      classRows: classes as unknown as ClassRow[],
    });
    cached = { at: Date.now(), body: knowledge };
    return NextResponse.json(knowledge, { headers: CACHE_HEADERS });
  } catch (e) {
    console.error('[public/knowledge]', e);
    // 公開・無認証のため内部情報は返さない。エラー応答にキャッシュヘッダは付けない。
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }
}
