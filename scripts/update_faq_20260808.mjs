import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 実ログ監査(2026-08-08・213問/105人)で見つかった「知識の穴」をTARO回答にもとづき補填する。
// 対象: ①発表会の見通し ②誤購入チケットの扱い ③公式プロデュースのチーム数 ④クラスの人数感

// ① 発表会: 正確な日付は公式発表前なので出さない。「2027年春頃・前回よりパワーアップ」までは言ってよい(TARO確定)
const RECITAL_A =
  'BOOMでは毎年ダンス発表会を開催しているよ！次回は2027年の春ごろに開催予定で、前回よりもボリュームアップ・パワーアップした内容でお届けする予定なんだ✨ 正式な日程や会場が決まったら、まず公式LINEでお知らせするから楽しみに待っててね😊';
const r1 = await c.execute({
  sql: 'UPDATE faq_entries SET answer=? WHERE id=37',
  args: [RECITAL_A],
});
console.log(`①発表会FAQ更新: ${r1.rowsAffected}件`);

// ②〜④ 新規追加(冪等: 同じ質問文があればスキップ)
const INSERTS = [
  {
    category: '料金・支払い',
    question: '間違えて購入したチケットはキャンセルできますか？',
    answer:
      'ごめんね、購入済みチケットのキャンセル・返金は基本的にできないんだ🙏 ただ、チケットは1枚チケットでも購入日から2ヶ月間有効だから、その期間内に別のレッスンで使ってもらえれば無駄にはならないよ！(予約を取った時点でチケットが購入され、レッスンを受けた時に消費される仕組みなんだ)\nどうしても事情がある場合は、公式LINEから相談してくれればケースバイケースで対応するよ😊',
  },
  {
    category: 'その他',
    question: 'BOOMにチームはありますか？',
    answer:
      'BOOMが公式にプロデュースしているチームは今のところ2チームあるよ（どちらもTAROがプロデュース）！チームプロデュースの仕組みは現在テスト段階で、これから整備していく予定なんだ🔥 興味があれば公式LINEから聞いてみてね！',
  },
  {
    category: 'レッスン',
    question: '1クラスに何人くらい生徒がいますか？',
    answer:
      'クラスやエリアによって違うけど、だいたい10〜20名くらいのことが多いよ！人気のクラス（七ヶ浜HIPHOP入門など）は毎回20名ほどでにぎやかだよ😊 少人数でじっくり受けたい・にぎやかな方が good など希望があれば、体験のときに聞いてみてね！',
  },
];

const maxRow = await c.execute('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq_entries');
let sort = Number(maxRow.rows[0].m);
let ins = 0,
  skip = 0;
for (const x of INSERTS) {
  const ex = await c.execute({ sql: 'SELECT id FROM faq_entries WHERE question=?', args: [x.question] });
  if (ex.rows.length) {
    skip++;
    continue;
  }
  sort++;
  await c.execute({
    sql: 'INSERT INTO faq_entries (category,question,answer,is_public,sort_order) VALUES (?,?,?,1,?)',
    args: [x.category, x.question, x.answer, sort],
  });
  ins++;
}
console.log(`②〜④ FAQ: inserted=${ins} skipped=${skip}`);
