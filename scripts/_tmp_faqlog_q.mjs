import { createClient } from '@libsql/client';
const c = createClient({ url: process.env.FAQBOT_LOG_DB_URL, authToken: process.env.FAQBOT_LOG_DB_TOKEN });
const q = async (sql) => (await c.execute(sql)).rows;
console.log('=== 日別(実ユーザー) ===');
for (const r of await q("SELECT substr(datetime(created_at,'+9 hours'),1,10) d, COUNT(*) q, COUNT(DISTINCT session_id) ppl FROM chat_logs WHERE role='user' AND is_test=0 GROUP BY d ORDER BY d"))
  console.log(`${r.d}  質問${r.q}  人${r.ppl}`);
console.log('\n=== 累計 ===');
console.log(await q("SELECT COUNT(*) q, COUNT(DISTINCT session_id) ppl, MIN(datetime(created_at,'+9 hours')) first, MAX(datetime(created_at,'+9 hours')) last FROM chat_logs WHERE role='user' AND is_test=0"));
console.log('\n=== カテゴリ内訳 ===');
for (const r of await q("SELECT COALESCE(category,'(未分類)') cat, COUNT(*) n FROM chat_logs WHERE role='assistant' AND is_test=0 GROUP BY cat ORDER BY n DESC")) console.log(`${r.cat}: ${r.n}`);
