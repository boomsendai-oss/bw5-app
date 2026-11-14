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
const waiting = await db.execute(`SELECT COUNT(*) n FROM gbp_reviews WHERE status IN ('new','draft_ready') AND reply_comment IS NULL`);
console.log(`自動で公開した返信（直近${hours}時間）: ${rows.length}件 / 人の確認待ち（★3以下など）: ${waiting.rows[0].n}件`);
for (const r of rows) console.log(`- ★${r.star_rating} ${r.reviewer_name}（${r.auto_posted_at} UTC）\n  ${r.reply_comment}`);
