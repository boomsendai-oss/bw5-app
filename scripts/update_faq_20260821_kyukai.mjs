// 休会FAQの期間を 4ヶ月 → 6ヶ月 へ修正 (2026-08-21)
// 経緯: 2026-07-15に「6ヶ月→4ヶ月へ短縮」が決定されたがHACOMONO実設定は変更されておらず、
// 実機は6ヶ月のままだった(TARO実機確認 2026-08-21)。ゼロベース再検討でも6ヶ月維持と決定。
// 公開FAQだけが「4ヶ月」と会員に不利な方向へ短く案内していたため修正する。
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/kimurashintarou/BOOM/BW5_2026/bw5-app/.env.local' });
import { createClient } from '@libsql/client';
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const ID = 21;
const before = await db.execute({ sql: 'SELECT id,question,answer FROM faq_entries WHERE id=?', args: [ID] });
if (!before.rows.length) throw new Error('FAQ id=21 が見つかりません');
const oldAnswer = before.rows[0].answer;
console.log('BEFORE:', oldAnswer);

if (!oldAnswer.includes('最長4ヶ月')) {
  console.log('「最長4ヶ月」を含まないため何もしません(既に修正済みの可能性)');
  process.exit(0);
}
const newAnswer = oldAnswer.replace('最長4ヶ月', '最長6ヶ月');
const res = await db.execute({
  sql: "UPDATE faq_entries SET answer=?, updated_at=datetime('now') WHERE id=? AND answer LIKE '%最長4ヶ月%'",
  args: [newAnswer, ID],
});
console.log('rowsAffected:', res.rowsAffected);
const after = await db.execute({ sql: 'SELECT answer FROM faq_entries WHERE id=?', args: [ID] });
console.log('AFTER :', after.rows[0].answer);
