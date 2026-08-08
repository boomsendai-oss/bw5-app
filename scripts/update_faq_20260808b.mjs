import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// プラン変更の手数料¥1,500がFAQに載っていなかったので追記する。
//
// 経緯: 2026-08-08に実際のプラン変更ウィザードを最終確認画面まで踏破したところ、
// 「プラン変更手続きを実行すると、プラン変更に伴う手数料等が即時決済されます /
//  システム変更手数料(コース変更、コース解約時のお手数料です) ¥1,500(税込)」と表示された。
// 休会FAQには同じ¥1,500が書いてあるのに、プラン変更FAQには無く、
// 「プラン変更にお金かかる？」にボットが答えられない状態だった。

const PLAN_CHANGE_A =
  'プラン変更(コース変更)は、BOOMポータルのマイページ→「契約管理」→「プランを変更」から自分でできるよ！\n' +
  '月会費が前払いだから、締切は毎月10日。10日までの手続きで翌月から、11日以降は翌々月からの適用になるんだ。\n' +
  // ボット側にMarkdownの描画が無いので ** は使わない(そのまま表示されてしまう)
  'それと、手続きにはシステム変更手数料¥1,500(税込)がかかるよ。実行したときに登録のカードから決済されるんだ(休会のときと同じ手数料だよ)。\n' +
  '画面つきの手順はこちら → https://bw5-app.vercel.app/guide/plan-change\n' +
  '不明点は公式LINEでお気軽にどうぞ😊';

const r = await c.execute({
  sql: "UPDATE faq_entries SET answer=? WHERE question LIKE '%プラン変更%' AND question LIKE '%どうすれば%'",
  args: [PLAN_CHANGE_A],
});
console.log(`プラン変更FAQ更新: ${r.rowsAffected}件`);

// 反映確認
const rows = await c.execute(
  "SELECT id, question, answer FROM faq_entries WHERE question LIKE '%プラン変更%'"
);
for (const row of rows.rows) {
  console.log(`\nid=${row.id} ${row.question}`);
  console.log(String(row.answer).slice(0, 220));
  console.log('  → ¥1,500の記載:', String(row.answer).includes('1,500') ? 'あり' : 'なし');
}
