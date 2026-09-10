import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

// 実ログ監査#5(2026-09-10)。旧回答が「キャンセルすればチケットが戻る」と無条件に読める
// 言い方をしていた(2026-07-12に2件)。5時間の期限自体はFAQにあったが、
// 「期限を過ぎたらどうなるか」が書かれておらず、そこが抜け道になっていた。
// TARO確認=期限を過ぎたらチケットは戻らない(消費される)。お金に直結するので明記する。
const A =
  'BOOMポータルの「予定管理」から予約状況を開き、該当のレッスンをキャンセルできます。' +
  'キャンセルできるのは、そのレッスンの終了後5時間以内までです（うっかりレッスン時間を過ぎても、この間であればまだ間に合います）。' +
  'この期限内にキャンセルすれば、チケットで予約していた場合は使わなかったチケットが手元に戻り、2ヶ月の有効期限内に別のレッスンでお使いいただけます。' +
  '\n⚠️ ただし、5時間の期限を過ぎるとキャンセルはできず、チケットは消費されます（戻りません）。お休みが決まったら早めの操作をおすすめします。' +
  '\n操作がうまくできない場合は公式LINEでご連絡ください。';

const r = await c.execute({ sql: 'UPDATE faq_entries SET answer=? WHERE id=19', args: [A] });
console.log(`FAQ id=19 更新: ${r.rowsAffected}件`);
