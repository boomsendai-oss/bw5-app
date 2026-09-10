import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 実ログ監査(2026-09-10・8/10〜9/9の35問)で「ぼかし/答えられなかった」質問をTARO回答にもとづき補填。
const INSERTS = [
  {
    category: 'BOOMポータル',
    question: '登録しているメールアドレスを変更したいです',
    answer:
      'メールアドレスの変更は、BOOMポータル(boom.hacomono.jp)にログインして、マイページ下部の「アカウント設定」→「メールアドレス変更」からご自身で手続きできます。新しいアドレス宛に認証メールが届くので、そこから確定してください。\n画面が見つからない・うまくいかない時は公式LINEでスタッフにご相談ください。',
  },
  {
    category: '料金・支払い',
    question: '追加チケット（追加受講チケット）とは何ですか？',
    answer:
      '月謝プランの回数を使い切った後、同じ月にもう一回レッスンを受けたい時に使うのが「追加受講チケット」です🎫 予約するタイミングで購入する形になります。料金は60分レッスン¥1,500／90分レッスン¥1,800です。\n※HOUSEエキスパートクラスのように、別途の追加チケットが必要なクラスもあります。詳しくは公式LINEで聞いてくださいね。',
  },
  {
    category: 'レッスン',
    question: 'ワークショップ（WS）をキャンセルしたら返金されますか？',
    answer:
      'ワークショップは、お申し込み後の払い戻しは基本的にできません🙏 ご都合が分かった段階で早めにお申し込みいただけると安心です。\nやむを得ない事情がある場合は個別に相談させていただくので、公式LINEからご連絡ください。',
  },
  {
    category: 'その他',
    question: '大人の生徒さんはどのくらいいますか？50代でも通えますか？',
    answer:
      'もちろん通えます！大人の方(20代〜60代)は全体で50名以上、そのうち50代以上の方も10名ほど在籍していますよ😊 特に日曜15:00〜の「ベーシックダンスクラス」(KEIKO先生・GOATスタジオ)は大人メインのクラスで、初めての方も多いです。\n年齢を気にせず始めている方がたくさんいるので、まずは体験で雰囲気を見てみてくださいね。',
  },
  {
    category: 'BOOMポータル',
    question: '契約プランが勝手に変更されているのですが',
    answer:
      'スクール側でプランを勝手に変更することはありません(システム上もできません)。よくあるのは、休会されていた方の休会期間が終わって「自動的に復会」したケースです。休会は期間が終わると自動で元のプランに戻り、月会費の請求も再開します📅\n心当たりがない場合は個別の確認が必要なので、公式LINEからご連絡ください。',
  },
];

const maxRow = await c.execute('SELECT COALESCE(MAX(sort_order),0) AS m FROM faq_entries');
let sort = Number(maxRow.rows[0].m), ins = 0, skip = 0;
for (const x of INSERTS) {
  const ex = await c.execute({ sql: 'SELECT id FROM faq_entries WHERE question=?', args: [x.question] });
  if (ex.rows.length) { skip++; continue; }
  sort++;
  await c.execute({
    sql: 'INSERT INTO faq_entries (category,question,answer,is_public,sort_order) VALUES (?,?,?,1,?)',
    args: [x.category, x.question, x.answer, sort],
  });
  ins++;
}
console.log(`FAQ: inserted=${ins} skipped=${skip}`);
