// 自動で公開した口コミ返信の一覧 (朝のまとめ用)。
// 使い方: node scripts/gbp-auto-posted.mjs --prod [--hours 24]
import { createClient } from '@libsql/client';
import fs from 'fs';
const env = Object.fromEntries(fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const hi = process.argv.indexOf('--hours');
const hours = hi > 0 ? Number(process.argv[hi + 1]) : 24;
const db = createClient({ url: env.TURSO_DATABASE_URL, authToken: env.TURSO_AUTH_TOKEN });
const { rows } = await db.execute({
  sql: `SELECT reviewer_name, star_rating, auto_posted_at, reply_comment FROM gbp_reviews
        WHERE auto_posted_at >= datetime('now', ?) ORDER BY auto_posted_at`,
  args: [`-${hours} hours`],
});
const waiting = (await db.execute(`SELECT reviewer_name, star_rating, hold_reason FROM gbp_reviews
  WHERE status IN ('new','draft_ready') AND reply_comment IS NULL ORDER BY create_time`)).rows;
console.log(`自動で公開した返信（直近${hours}時間）: ${rows.length}件 / 人の確認待ち: ${waiting.length}件`);
for (const w of waiting) console.log(`- 確認待ち ★${w.star_rating} ${w.reviewer_name}：${w.hold_reason ?? (Number(w.star_rating) <= 3 ? '★3以下' : '下書き待ち')}`);
for (const r of rows) console.log(`- ★${r.star_rating} ${r.reviewer_name}（${r.auto_posted_at} UTC）\n  ${r.reply_comment}`);
