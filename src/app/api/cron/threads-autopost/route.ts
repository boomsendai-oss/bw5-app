import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import { configured as threadsConfigured, connectionStatus, postText } from '@/lib/threads';
import { partitionExpired, pickDuePosts } from '@/lib/xPosts';
import {
  MAX_THREADS_POSTS_PER_RUN,
  resolveLinkedAction,
  validateThreadsText,
  type ThreadsPostRow,
} from '@/lib/threadsPosts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Threadsテキスト投稿 自動ポストcron (SNSテキスト配信レーン 2026-08-06)。
// GitHub Actions から15分おき(Xと7分ずらし)に叩かれる。x-autopost と同じ思想:
//   1. x_post_id リンク行の draft を、X側の承認/ボツに追従させる(resolveLinkedAction)
//   2. status='approved' かつ scheduled_at <= now を古い順に最大5件 postText で投稿
// 失敗しても自動リトライしない(x_postsと同じ・差し戻しはDB操作 or 将来のUIで)。
// ⚠️ 認証: withAuthではなくCRON_SECRET(fail-closed)。GH Actionsから叩くため(x-autopostと同パターン)
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 未設定なら拒否 (無認証公開を防ぐ)
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!threadsConfigured()) {
    return NextResponse.json({ ok: true, configured: false, status: 'dormant', note: 'Threads env未設定のためスキップ' });
  }
  const conn = await connectionStatus();
  if (!conn.threadsConnected) {
    return NextResponse.json({ ok: true, configured: true, status: 'dormant', note: 'Threads未連携のためスキップ' });
  }

  // 1. リンク行のX承認追従 (draftのみ対象・判定はテスト済み純関数)
  const linkedDrafts = (await getAll(
    `SELECT t.id, t.status, x.status AS x_status
       FROM threads_posts t JOIN x_posts x ON x.id = t.x_post_id
      WHERE t.status = 'draft' LIMIT 200`
  )) as Array<{ id: number; status: string; x_status: string }>;
  let approvedBySync = 0;
  let rejectedBySync = 0;
  for (const row of linkedDrafts) {
    const action = resolveLinkedAction(row.status, row.x_status);
    if (action === 'none') continue;
    const next = action === 'approve' ? 'approved' : 'rejected';
    const res = await execute(
      "UPDATE threads_posts SET status = ?, updated_at = datetime('now') WHERE id = ? AND status = 'draft'",
      [next, row.id]
    );
    if (Number(res.rowsAffected) > 0) {
      if (action === 'approve') approvedBySync++;
      else rejectedBySync++;
    }
  }

  // 2. 期日到来分の投稿
  const now = nowUtcIso();
  const approved = (await getAll(
    `SELECT * FROM threads_posts WHERE status = 'approved' AND scheduled_at IS NOT NULL ORDER BY scheduled_at ASC, id ASC LIMIT 100`
  )) as ThreadsPostRow[];
  // 予約時刻を2時間超過したものは投稿せず自動見送り(x-autopostと同じガード)
  const { due: withinGrace, expired } = partitionExpired(approved, now);
  for (const p of expired) {
    await execute(
      "UPDATE threads_posts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND status = 'approved'",
      ['予約時刻を2時間以上過ぎたため自動見送り(時刻を設定し直すと再試行できます)', p.id]
    );
  }
  const due = pickDuePosts(withinGrace, now, MAX_THREADS_POSTS_PER_RUN);

  const results: Array<Record<string, unknown>> = [];
  let posted = 0;
  let failed = 0;

  for (const post of due) {
    // 二重投稿ガード: approved のままのものだけを 'posting' に原子的に更新して着手 (x-autopostと同じ)
    const claim = await execute(
      "UPDATE threads_posts SET status = 'posting', updated_at = datetime('now') WHERE id = ? AND status = 'approved'",
      [post.id]
    );
    if (Number(claim.rowsAffected) === 0) {
      results.push({ id: post.id, skipped: '他プロセスが処理中' });
      continue;
    }

    try {
      const invalid = validateThreadsText(post.text);
      if (invalid) throw new Error(invalid);
      const { id: threadId, permalink } = await postText(post.text);
      await execute(
        "UPDATE threads_posts SET status = 'posted', posted_thread_id = ?, permalink = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
        [threadId, permalink, post.id]
      );
      posted++;
      results.push({ id: post.id, thread_id: threadId, permalink });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await execute(
        "UPDATE threads_posts SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?",
        [msg, post.id]
      );
      failed++;
      results.push({ id: post.id, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    synced: { approved: approvedBySync, rejected: rejectedBySync },
    due: due.length,
    posted,
    failed,
    results,
  });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
