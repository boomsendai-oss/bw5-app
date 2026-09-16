// 料金改定(2026-12-01適用・2026-09-16告知)のFAQを追加 (2026-09-16)
// 経緯: 告知当日からボットに「料金は変わる?/いくら?/いつから引き落とし?/手続きは?/HOUSEエキスパートは?」が来る。
// 方針: hacomono_products(現行価格)は12/1まで触らない。改定は「予定」としてFAQ側だけに持たせる。
//      既存の料金FAQ(id12/13)には改定予告の1行を末尾に足し、ボットが現行価格を断定しきらないようにする。
// ⚠️ボットにMarkdownの描画は無いので回答文に ** を使わないこと。
// 冪等: 同じ質問文が既にあれば追加しない。追記も既に入っていればしない。
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.env.local' });
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const CAT = '料金・支払い';
const ENTRIES = [
  ['レッスン料金は変わりますか？', [
    'はい。2026年12月1日から、プランの内容と料金を改定します(全体でおおよそ1割強の値上げです)。',
    '11月分までのお月謝はこれまでどおりで、12月分から新しい料金になります。',
    '改定後の全プランの料金は、公式サイトの料金ページで「2026年12月〜」を押すとご覧いただけます。',
    'https://boom-sendai.com/price/',
    '入会金(4,000円)と体験レッスン(無料)は据え置きです。',
  ]],
  ['12月からの新しい料金はいくらですか？', [
    '2026年12月1日からの主な月謝プランの料金です(現在 → 改定後)。',
    '・60分 月4回 6,000円 → 6,700円',
    '・90分 月4回 7,200円 → 8,100円',
    '・60分 月8回 10,800円 → 12,100円',
    '・90分 月8回 12,800円 → 14,300円',
    '・受け放題 14,000円 → 15,700円',
    'カレッジ(学割)・チケット・追加受講・ビジターの改定後料金は、公式サイトの料金ページで「2026年12月〜」を押すとご覧いただけます。',
    'https://boom-sendai.com/price/',
  ]],
  ['新しい料金はいつの支払いから適用されますか？', [
    '月会費は前払い制のため、12月分にあたるお支払いから新しい料金になります。',
    '・クレジットカード:11月20日の決済から',
    '・口座振替:11月27日ごろの引き落としから',
    '11月分までのお支払いは、これまでどおりの料金です。',
  ]],
  ['料金改定にあたって手続きは必要ですか？', [
    '会員さま側でのお手続きは必要ありません。12月分から自動的に新しい料金に切り替わります。',
    'プランの変更をご希望の場合は、これまでどおり毎月10日までにお手続きいただくと翌月から適用されます。12月分から変更したい場合は、11月10日までにお願いします。',
    'ご事情のあるご相談は、公式LINEでお気軽にお知らせください。',
  ]],
  ['HOUSEエキスパートは12月からどう変わりますか？', [
    '2026年12月1日から、HOUSEエキスパートは月謝プランの回数・受け放題でご受講いただけるようになります(これまでは専用チケット2,000円が必要でした)。',
    '・受け放題の方:追加料金なしで受講できます',
    '・90分プランの方:回数を1回使って受講できます',
    '・60分プランの方:90分レッスンの追加受講チケットで受講できます',
    '・チケット会員の方:90分チケットで受講できます',
    'これまでどおり、HOUSEの基礎が身についた方向けのクラスです。専用チケットは11月末で販売を終了します。',
  ]],
];

let added = 0;
for (const [q, lines] of ENTRIES) {
  const ex = await db.execute({ sql: 'SELECT id FROM faq_entries WHERE question = ?', args: [q] });
  if (ex.rows.length) { console.log('既存のため追加せず:', q, '(id=' + ex.rows[0].id + ')'); continue; }
  const mx = await db.execute('SELECT COALESCE(MAX(sort_order),0) AS mx FROM faq_entries');
  const res = await db.execute({
    sql: 'INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?, ?, ?, 1, ?)',
    args: [CAT, q, lines.join('\n'), Number(mx.rows[0].mx) + 1],
  });
  added += res.rowsAffected; console.log('追加:', q);
}

// 既存の料金FAQ(現行価格を答えるもの)に改定予告を1行足す
const NOTE = '\n※2026年12月1日から料金が改定されます(11月分まではこの料金です)。改定後の料金は「レッスン料金は変わりますか？」をご覧ください。';
for (const id of [12, 13]) {
  const r = await db.execute({ sql: 'SELECT answer FROM faq_entries WHERE id = ?', args: [id] });
  if (!r.rows.length) continue;
  const a = String(r.rows[0].answer);
  if (a.includes('2026年12月1日から料金が改定')) { console.log('id', id, 'は追記済み'); continue; }
  await db.execute({ sql: 'UPDATE faq_entries SET answer = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [a + NOTE, id] });
  console.log('id', id, 'に改定予告を追記');
}

const chk = await db.execute({ sql: 'SELECT id, question, is_public FROM faq_entries WHERE category = ? ORDER BY id', args: [CAT] });
console.log('--- 料金・支払い カテゴリ現在 ---'); for (const r of chk.rows) console.log(r.id, r.is_public, r.question);
const bad = await db.execute("SELECT id FROM faq_entries WHERE answer LIKE '%**%'");
console.log('追加数:', added, '/ Markdown混入:', bad.rows.length);
