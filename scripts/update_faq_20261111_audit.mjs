import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 実ログ監査(2026-10-11〜11-11・60問)で見つかった誤答・知識の穴を、TAROの回答(2026-11-11)で埋める。
// 冪等: 更新は置き換え前の文言がある時だけ、追加は同じ質問が無い時だけ。
// ⚠️ボットはMarkdownを描画しないので回答に ** を使わない。

const UPDATES = [
  // 確定情報なのに「スタッフに確認して」で終わり、ボットが毎回余計な一言を足していた
  { id: 23, from: '(金融機関の休業日は翌営業日)。詳しい日程はスタッフにご確認ください。', to: '(金融機関の休業日は翌営業日)。' },
  // 口座振替の人にも「カードから決済」と答えていた
  { id: 20, from: '実行したときに登録のカードから決済されるんだ(休会のときと同じ手数料だよ)。', to: '手続きを実行したときに決済されるんだ(休会のときと同じ手数料だよ)。' },
  // 体験は最後まで見学OK(TARO 11/11)。在籍している子の「最後の5分だけ」と区別
  { id: 35, from: 'レッスンの最後の5分間だけ、保護者の方もスタジオに入ってご覧いただけます。', to: '体験レッスンの場合は、保護者の方も最初から最後までご覧いただけます。クラスの雰囲気をぜひ見てくださいね。\n入会後の通常レッスンでは、レッスンの最後の5分間だけ、保護者の方もスタジオに入ってご覧いただけます。' },
  // 11月の今も「入門」の名前で案内してよい(TARO 11/11)
  { id: 63, from: '・日曜12:45〜の「多賀城 HIPHOP 基礎」は、12月から「多賀城 HIPHOP 入門」になります(AOI先生／T\'s STUDIO)', to: '・日曜12:45〜の「多賀城 HIPHOP 基礎」は「多賀城 HIPHOP 入門」に名前が変わりました(AOI先生／T\'s STUDIO)' },
];

const INSERTS = [
  { category: '体験', question: 'きょうだい・親子など2人以上で体験を申し込みたいです',
    answer: '体験レッスンの予約は1人ずつ受け付けています。お手数ですが、体験の予約フォームからお一人ずつそれぞれお申し込みください(1回の申し込みで2人目を入力することはできません)。\nうまく申し込めない時は公式LINEでスタッフにご相談ください。' },
  { category: '料金・支払い', question: '月謝プランに最低契約期間(〇ヶ月以上など)はありますか？',
    answer: '最低契約期間はありません。月謝プランは1ヶ月から始められます。やめる・休む時の手続きの締切(毎月10日)だけご注意ください。' },
  { category: '料金・支払い', question: '90分のチケットで60分のレッスンは受けられますか？',
    answer: 'はい、90分のチケットで60分のレッスンも受けられます。' },
  { category: '料金・支払い', question: 'チケット会員から月謝プランに切り替える時も手数料はかかりますか？',
    answer: 'はい、チケット会員から月謝プランへの切り替えもプラン変更の扱いになり、システム変更手数料¥1,500(税込)がかかります。締切は毎月10日で、10日までの手続きで翌月から月謝プランになります。' },
  { category: '料金・支払い', question: '口座振替でチケットを買えますか？',
    answer: '口座振替は月謝プランの方だけのお支払い方法です。チケット(1回・5回)の購入はクレジットカードでのお支払いになります。' },
  { category: 'その他', question: '何歳まで通えますか？年齢の上限はありますか？',
    answer: '年齢の上限はありません！60代の方も実際に通っていますよ。大人の方が特に多いのは日曜15:00〜の「ベーシックダンスクラス」(KEIKO先生)です。まずは体験で雰囲気を見てみてくださいね。' },
  { category: 'その他', question: '大人が多いクラスはどれですか？',
    answer: 'いちばん大人の方が多いのは、日曜15:00〜の「ベーシックダンスクラス」(KEIKO先生・GOATスタジオ)です。\nほかにも大人の方がちらほら参加しているクラスとして、TARO先生の「HIPHOP 入門初級」(11月までは水曜18:30〜、12月からは木曜18:30〜)、月曜の「多賀城 JAZZ」(KEIKO先生)、日曜の「おっちゃん NEW JACK SWING」、水曜の「HOUSE 初級」(K@TTSU先生)などがあります。' },
  { category: 'レッスン', question: 'フリースタイル(即興で踊ること)を練習できるクラスはありますか？',
    answer: 'フリースタイルは、どのクラスでもレッスンの中で練習することがあります。特に多いのは、ちゃんなつ先生の「ちゃんなつ HIPHOP」(日曜)、TARO先生の「HIPHOP 中級」(月曜)、K@TTSU先生のHOUSEのクラスです。\nまた、不定期で「フリースタイルの練習会」も開いているので、そちらに参加するのもおすすめです。開催は公式LINEでお知らせします。\n※「SAYUKI FREESTYLE」はクラスの名前で、毎回振り付けを踊るクラスです。' },
  { category: 'その他', question: 'BOOMのTシャツは買えますか？',
    answer: 'はい、買えます！公式LINEのメニューの「その他」からショップに進んで、そこからご購入いただけます。' },
  { category: 'BOOMポータル', question: 'クーポンはどこで確認できますか？',
    answer: 'クーポンは種類によって受け取り方・使い方が違います。それぞれのクーポンの公式のご案内(公式LINEのお知らせなど)をご確認ください。わからない時は公式LINEでスタッフにお気軽にどうぞ。' },
  { category: '料金・支払い', question: 'チケットの有効期限はいつまでですか？',
    answer: 'チケットは購入日から2ヶ月間有効で、2ヶ月後の同じ日までお使いいただけます(例: 10月24日に購入したら12月24日まで)。1回チケットも5回チケットも同じです。' },
  { category: '料金・支払い', question: '振替チケットとは何ですか？',
    answer: '月謝プランの方には、毎月のプランの回数分のチケット(振替チケット)が付与され、レッスンを予約するとそのチケットが使われます。月謝プランの回数はその月で終わり、翌月への繰り越しはできません。くわしくは会員規約をご覧いただくか、公式LINEでご相談ください。' },
  { category: 'その他', question: '向山のスタジオ(教室)はまだありますか？',
    answer: '向山で行っていた日曜のキッズクラスは、2026年7月から本町のGOATスタジオに移りました。今のクラスの場所はスタジオへのアクセスのページでご確認ください。' },
];

let up = 0, ins = 0, skip = 0;
for (const u of UPDATES) {
  const r = await c.execute({ sql: 'UPDATE faq_entries SET answer=replace(answer, ?, ?), updated_at=CURRENT_TIMESTAMP WHERE id=? AND instr(answer, ?) > 0 AND instr(answer, ?) = 0', args: [u.from, u.to, u.id, u.from, u.to] });
  console.log(`更新 id=${u.id}: ${r.rowsAffected}件`); up += r.rowsAffected;
}
let sort = Number((await c.execute('SELECT max(sort_order) s FROM faq_entries')).rows[0].s);
for (const x of INSERTS) {
  const ex = await c.execute({ sql: 'SELECT id FROM faq_entries WHERE question=?', args: [x.question] });
  if (ex.rows.length) { skip++; continue; }
  await c.execute({ sql: 'INSERT INTO faq_entries (category,question,answer,is_public,sort_order) VALUES (?,?,?,1,?)', args: [x.category, x.question, x.answer, ++sort] });
  ins++;
}
console.log(`更新=${up} 追加=${ins} 既存スキップ=${skip}`);
