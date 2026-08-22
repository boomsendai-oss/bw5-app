// 会員規約の案内FAQを追加 (2026-08-22)
// 経緯: 規約をNotionから公式サイト( boom-sendai.com/terms )へ移設したが、
// FAQには「規約」を扱う問いが1件も無く(検索0件)、ボットが案内先を持っていなかった。
// ⚠️ボットにMarkdownの描画は無いので回答文に ** を使わないこと(そのまま会員に表示される)。
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.env.local' });
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const QUESTION = '会員規約はどこで見られますか？';
const ANSWER = [
  'BOOMの会員規約は、公式サイトでご覧いただけます。',
  'https://boom-sendai.com/terms/',
  '',
  '入会・会費のお支払い・休会・退会・レッスンの受講など、スクールをご利用いただくうえでの取り決めを掲載しています。ご入会の際は、この規約にご同意いただいたうえでお手続きいただいています。',
  'ページの一番下に改定履歴もありますので、いつ何が変わったかもご確認いただけます。ご不明な点は公式LINEでお気軽にご相談ください。',
].join('\n');

const exists = await db.execute({
  sql: 'SELECT id FROM faq_entries WHERE question = ?',
  args: [QUESTION],
});
if (exists.rows.length > 0) {
  console.log('既に存在するため何もしません: id=' + exists.rows[0].id);
  process.exit(0);
}

const mx = await db.execute("SELECT COALESCE(MAX(sort_order), 0) AS mx FROM faq_entries");
const sort = Number(mx.rows[0].mx) + 1;

const res = await db.execute({
  sql: `INSERT INTO faq_entries (category, question, answer, is_public, sort_order)
        VALUES ('その他', ?, ?, 1, ?)`,
  args: [QUESTION, ANSWER, sort],
});
console.log('rowsAffected:', res.rowsAffected, '/ sort_order:', sort);

const after = await db.execute({ sql: 'SELECT id, category, is_public, answer FROM faq_entries WHERE question = ?', args: [QUESTION] });
console.log('--- 登録内容 ---');
console.log('id =', after.rows[0].id, '/ category =', after.rows[0].category, '/ is_public =', after.rows[0].is_public);
console.log(after.rows[0].answer);
console.log('--- Markdown記号(**)の混入:', String(after.rows[0].answer).includes('**'));
