import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import { postTweet, xConfigured } from '@/lib/xApi';
import {
  MAX_POSTS_PER_RUN,
  parsePartsJson,
  pickDuePosts,
  type XPostRow,
} from '@/lib/xPosts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// X投稿 自動ポストcron (2026-07-17)。GitHub Actions から15分おきに叩かれる。
// status='approved' かつ scheduled_at <= 現在時刻 のものを古い順に最大5件、
// X API v2 でポストする(ツリーは reply.in_reply_to_tweet_id で連結)。
// 失敗しても自動リトライしない — /staff/x-posts から差し戻し→再承認で再試行する。
// 認証: Authorization: Bearer <CRON_SECRET> または x-cron-secret ヘッダ (gbp-reviewsと同パターン)
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
  if (!xConfigured()) {
    // X APIキー開通前は何もせず成功扱い (cron自体は先に稼働させておく安全設計)
    return NextResponse.json({ ok: true, configured: false, status: 'dormant', note: 'X API env未設定のためスキップ' });
  }

  const now = nowUtcIso();
  // 承認済みを全件取り、対象選定(due判定・古い順・最大5件)はテスト済みの純関数で行う
  const approved = (await getAll(
    `SELECT * FROM x_posts WHERE status = 'approved' AND scheduled_at IS NOT NULL ORDER BY scheduled_at ASC, id ASC LIMIT 100`
  )) as XPostRow[];
  const due = pickDuePosts(approved, now, MAX_POSTS_PER_RUN);

  const results: Array<Record<string, unknown>> = [];
  let posted = 0;
  let failed = 0;

  for (const post of due) {
    // 二重投稿ガード: approved のままのものだけを 'posting' に原子的に更新して着手する。
    // (cron二重発火・手動dispatch重複対策。途中クラッシュ時は 'posting' のまま残り
    //  再投稿されない=安全側。画面の「失敗」タブから差し戻して再試行する)
    const claim = await execute(
      "UPDATE x_posts SET status = 'posting', updated_at = datetime('now') WHERE id = ? AND status = 'approved'",
      [post.id]
    );
    if (Number(claim.rowsAffected) === 0) {
      results.push({ id: post.id, skipped: '他プロセスが処理中' });
      continue;
    }

    const parts = parsePartsJson(post.parts);
    const postedIds: string[] = [];
    try {
      if (parts.length === 0) throw new Error('partsが空(JSON不正または0要素)');
      for (let i = 0; i < parts.length; i++) {
        const id = await postTweet(parts[i], i > 0 ? postedIds[i - 1] : undefined);
        postedIds.push(id);
      }
      await execute(
        "UPDATE x_posts SET status = 'posted', posted_tweet_ids = ?, error = NULL, updated_at = datetime('now') WHERE id = ?",
        [JSON.stringify(postedIds), post.id]
      );
      posted++;
      results.push({ id: post.id, tweets: postedIds.length, tweet_ids: postedIds });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // ツリー途中失敗でも投稿済み分のIDは保存する(画面で状況が分かるように)
      await execute(
        "UPDATE x_posts SET status = 'failed', posted_tweet_ids = ?, error = ?, updated_at = datetime('now') WHERE id = ?",
        [postedIds.length > 0 ? JSON.stringify(postedIds) : null, msg, post.id]
      );
      failed++;
      results.push({ id: post.id, error: msg, partial_posted: postedIds.length });
    }
  }

  return NextResponse.json({ ok: true, configured: true, due: due.length, posted, failed, results });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
