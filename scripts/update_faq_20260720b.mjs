import { createClient } from '@libsql/client';
const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
// 「見学」が2義(入会前の見学予約 / 通っている子のレッスンを保護者が中で見る)で衝突するため、
// 既存の見学FAQにも保護者見学(ラスト5分)への案内を追記して、どちらから来ても正しい答えに届くようにする。
const res = await client.execute({
  sql: "UPDATE faq_entries SET answer = ?, updated_at = datetime('now') WHERE question = ?",
  args: [
    '見学も大歓迎です！体験と同じ予約フォーム(カレンダー)で「見学」を選んで予約してください。なお、すでに通っているお子さんのレッスンを保護者の方がご覧になる場合は、レッスンの最後の5分間だけスタジオに入っていただけます。',
    '見学は可能ですか？',
  ],
});
console.log('updated rows =', res.rowsAffected);
