#!/usr/bin/env node
// FAQ追加スクリプト (WS O・ベータ保護者FB第1弾・2026-07-19)
// 駐車場FAQを追加(HP boom-hp/src/app/faq/page.tsx の文言を転記)。冪等(question未存在時のみINSERT)。
import { createClient } from '@libsql/client';
const url = process.env.TURSO_DATABASE_URL || 'file:./data/bw5.db';
const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

const INSERTS = [
  {
    category: 'その他',
    question: '駐車場はありますか？',
    answer:
      '会場によって異なります。長町コナスポスタジオ（ララガーデン長町）、アクアスタジオ（アクアリーナ）、七ヶ浜国際村には駐車場があります。その他の会場は、近隣のコインパーキングをご利用ください。',
  },
];

async function main() {
  const maxRow = await client.execute('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq_entries');
  let sort = Number(maxRow.rows[0].m);
  let inserted = 0, skipped = 0;
  for (const ins of INSERTS) {
    const ex = await client.execute({ sql: 'SELECT id FROM faq_entries WHERE question = ?', args: [ins.question] });
    if (ex.rows.length > 0) { skipped++; continue; }
    sort++;
    await client.execute({
      sql: 'INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?, ?, ?, 1, ?)',
      args: [ins.category, ins.question, ins.answer, sort],
    });
    inserted++;
  }
  console.log(`inserted=${inserted} skipped=${skipped}`);
}
main().catch((e) => { console.error('FAILED:', e instanceof Error ? e.message : String(e)); process.exit(1); });
