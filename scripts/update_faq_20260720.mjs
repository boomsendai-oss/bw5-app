#!/usr/bin/env node
// FAQ追加 (WS O・保護者ベータFB第1弾 #3: 見学/付き添い・2026-07-20 TARO確認)
import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const INSERTS = [
  {
    category: '体験',
    question: 'レッスンの見学（保護者の付き添い）はできますか？',
    answer: 'レッスンの最後の5分間だけ、保護者の方もスタジオに入ってご覧いただけます。それまでの時間は中に入らずお待ちいただく形です。スタジオまでの送り迎えの付き添いは自由なので、外で待っていただいても、お子さんだけお預けいただいても大丈夫ですよ。',
  },
];
const maxRow = await client.execute('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq_entries');
let sort = Number(maxRow.rows[0].m), inserted = 0, skipped = 0;
for (const ins of INSERTS) {
  const ex = await client.execute({ sql: 'SELECT id FROM faq_entries WHERE question = ?', args: [ins.question] });
  if (ex.rows.length > 0) { skipped++; continue; }
  sort++;
  await client.execute({ sql: 'INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?, ?, ?, 1, ?)', args: [ins.category, ins.question, ins.answer, sort] });
  inserted++;
}
console.log(`inserted=${inserted} skipped=${skipped}`);
