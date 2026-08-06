#!/usr/bin/env node
// SNSテキスト投稿のキュー投入スクリプト(広報部/編集部の恒久ツール 2026-08-06)。
// x_posts + threads_posts に draft を連動投入する(threads側はx_post_idリンク=X承認に追従)。
// 投稿はTAROが /staff/x-posts で承認してから。ここでは公開されない。
//
// 使い方:
//   node scripts/sns/queue_post.mjs --x "X用テキスト" [--threads "Threads用全文"] [--sched "2026-08-08T03:00:00Z"]
//   --threads 省略時はXと同文 / --sched 省略時は予約なし(cron対象外・手動で時刻設定)
//   --x-only でThreads行を作らない / --dry-run で検証のみ
//
// 環境変数: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN (bw5-appの .env.local を source する)
import { createClient } from '@libsql/client';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null;
}
const flag = (name) => process.argv.includes(`--${name}`);

const xText = arg('x');
const threadsText = arg('threads') ?? xText;
const sched = arg('sched');
const xOnly = flag('x-only');
const dryRun = flag('dry-run');

if (!xText) {
  console.error('必須: --x "X用テキスト"');
  process.exit(1);
}

// X weighted length (src/lib/xPosts.ts tweetWeightedLength と同じ近似)
function tweetWeightedLength(text) {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const light =
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
}

const xw = tweetWeightedLength(xText);
if (xw > 280) {
  console.error(`NG: X本文が上限超過 (weighted ${xw}/280 ≒ 日本語${Math.ceil(xw / 2)}字)。短縮してください`);
  process.exit(1);
}
if ([...threadsText].length > 500) {
  console.error(`NG: Threads本文が500字超過 (${[...threadsText].length}字)`);
  process.exit(1);
}
if (sched && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(sched) || Number.isNaN(Date.parse(sched)))) {
  console.error('NG: --sched はUTCのISO形式 (例 2026-08-08T03:00:00Z)');
  process.exit(1);
}
if (sched && Date.parse(sched) < Date.now()) {
  console.error('NG: --sched が過去時刻です');
  process.exit(1);
}

console.log(`検証OK: X=${xw}/280 weighted, Threads=${[...threadsText].length}/500字, sched=${sched ?? 'なし(手動)'}`);
if (dryRun) process.exit(0);

const c = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const dup = await c.execute({
  sql: "SELECT id, status FROM x_posts WHERE parts = ? AND status IN ('draft','approved','posting','posted')",
  args: [JSON.stringify([xText])],
});
if (dup.rows.length) {
  console.error(`NG: 同文のX投稿が既に存在 (id=${dup.rows[0].id}, ${dup.rows[0].status})`);
  process.exit(1);
}

const rx = await c.execute({
  sql: "INSERT INTO x_posts (account, parts, scheduled_at, status) VALUES ('boom', ?, ?, 'draft')",
  args: [JSON.stringify([xText]), sched],
});
const xId = Number(rx.lastInsertRowid);
console.log(`x_posts: draft id=${xId}`);

if (!xOnly) {
  const rt = await c.execute({
    sql: "INSERT INTO threads_posts (x_post_id, text, scheduled_at, status) VALUES (?, ?, ?, 'draft')",
    args: [xId, threadsText, sched],
  });
  console.log(`threads_posts: draft id=${Number(rt.lastInsertRowid)} (x${xId}に追従)`);
}
console.log('投入完了。TAROの承認(/staff/x-posts)後に予約時刻で自動配信されます');
