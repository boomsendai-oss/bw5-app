import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 固定QRコード自動発行(WS U)をFAQボットに反映。スマホを持たない子どものチェックイン質問に回答する。
const CATEGORY = 'BOOMポータル';
const Q = 'スマホを持っていない子どもでも、一人でチェックインできますか？';
const A =
  'できるよ！印刷して使える「固定QRコード」を用意しているんだ🔐 マイページのQRコード(30分で切り替わるやつ)と違って、この固定QRはずっと使えるから、紙に印刷してお子さんに持たせておけば、入口のタブレットにかざすだけで一人でもチェックインできるよ。\n' +
  '発行はかんたん。BOOMポータルの左メニュー「印刷用(固定)QRコードの発行」から申し込むと、ご登録のメールアドレスに、通常1〜2時間以内にQRコードが届くよ📧 届いたら印刷して持たせてあげてね。\n' +
  '⚠️このQRは他の人と共有しないでね(他の人がチェックインするとチケットが使われちゃうよ)。もし紙をなくしても、同じ手順でもう一度申し込めば同じQRを送り直せるから安心してね😊';

const existing = await c.execute({ sql: 'SELECT id FROM faq_entries WHERE question=?', args: [Q] });
if (existing.rows.length) {
  const r = await c.execute({ sql: 'UPDATE faq_entries SET category=?, answer=?, is_public=1 WHERE question=?', args: [CATEGORY, A, Q] });
  console.log(`FAQ更新: ${r.rowsAffected}件 (id=${existing.rows[0].id})`);
} else {
  const mx = await c.execute({ sql: 'SELECT COALESCE(MAX(sort_order),0)+1 s FROM faq_entries WHERE category=?', args: [CATEGORY] });
  const sort = mx.rows[0].s;
  const r = await c.execute({
    sql: 'INSERT INTO faq_entries (category, question, answer, is_public, sort_order) VALUES (?,?,?,1,?)',
    args: [CATEGORY, Q, A, sort],
  });
  console.log(`FAQ追加: id=${r.lastInsertRowid} sort=${sort}`);
}
