#!/usr/bin/env node
// 二次配信(reel_crossposts)の打ち止め・失敗行をまとめて再開する。
//
// 鍵切れ・残高切れなどで止まっていた行を pending / attempts=0 に戻す。
// **戻す前に日付切れの告知を判定し、該当行は 'cancelled' にして戻さない**
// (判定は src/lib/crosspostStaleDate.ts。cron /api/cron/crosspost-reel と共通)。
// 2026-11-13: 手作業で一括 pending に戻したら「明日11/11」のリールが11/13にXへ出たため用意した。
//
// 使い方:
//   node scripts/crosspost_revive.mjs --prod --platform threads          見るだけ(何も変えない)
//   node scripts/crosspost_revive.mjs --prod --platform threads --apply  実際に戻す
//   --platform は x / threads / youtube / facebook。カンマ区切りで複数可(tiktokはMac常駐の持ち物なので不可)
//   --status で戻す対象の状態を変えられる(既定: failed。skipped も含めるなら --status failed,skipped)
import { makeClient } from './seed_recurring_expenses.mjs';
import { findExpiredMention, staleReason } from '../src/lib/crosspostStaleDate.ts';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ALLOWED = new Set(['x', 'threads', 'youtube', 'facebook']);
const platforms = (arg('--platform') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const statuses = (arg('--status') ?? 'failed').split(',').map((s) => s.trim()).filter(Boolean);
const apply = process.argv.includes('--apply');

if (platforms.length === 0 || platforms.some((p) => !ALLOWED.has(p))) {
  console.error('--platform に x / threads / youtube / facebook を指定してください(カンマ区切り可)');
  process.exit(2);
}
if (statuses.some((s) => !['failed', 'skipped'].includes(s))) {
  console.error('--status は failed / skipped のみ');
  process.exit(2);
}

const c = makeClient(process.argv);
const ph = (a) => a.map(() => '?').join(',');
const rows = (
  await c.execute({
    sql: `SELECT cp.id, cp.reel_id, cp.platform, cp.status, cp.attempts, q.caption, q.posted_at
          FROM reel_crossposts cp LEFT JOIN reel_queue q ON q.id = cp.reel_id
          WHERE cp.platform IN (${ph(platforms)}) AND cp.status IN (${ph(statuses)})
          ORDER BY cp.reel_id DESC, cp.id`,
    args: [...platforms, ...statuses],
  })
).rows;

const now = new Date();
const nowIso = now.toISOString();
let revived = 0;
let cancelled = 0;
for (const r of rows) {
  const hit = findExpiredMention(r.caption, r.posted_at, now);
  if (hit) {
    const reason = staleReason(hit);
    console.log(`  取消  #${r.id} reel${r.reel_id}/${r.platform} — ${reason}`);
    if (apply) {
      await c.execute({
        sql: `UPDATE reel_crossposts SET status='cancelled', error=?, updated_at=? WHERE id=? AND status=?`,
        args: [reason, nowIso, r.id, r.status],
      });
    }
    cancelled++;
  } else {
    console.log(`  再開  #${r.id} reel${r.reel_id}/${r.platform} (${r.status}, 試行${r.attempts})`);
    if (apply) {
      await c.execute({
        sql: `UPDATE reel_crossposts SET status='pending', attempts=0, error=NULL, updated_at=? WHERE id=? AND status=?`,
        args: [nowIso, r.id, r.status],
      });
    }
    revived++;
  }
}
console.log(`\n${apply ? '実行' : '見るだけ(--apply で実行)'}: 再開 ${revived}件 / 日付切れで取消 ${cancelled}件`);
