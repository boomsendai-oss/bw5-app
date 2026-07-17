import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import { configured as igConfigured, publishReel, refreshTokenIfStale } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// リール自動投稿 (毎日 JST 19:00 に GitHub Actions cron から叩かれる)。
// 19-20時 = boom_sendaiフォロワーのオンライン活動ピーク帯(実測)。
// reel_queue から期限が来た scheduled を1件だけ公開する(複数期限切れでも1回1件=連投防止。
// リトライcronが後続を拾う)。
// 冪等性: UPDATE ... WHERE status='scheduled' のclaimで多重発火・リトライから保護。
// 認証: post-story と同パターン (Bearer CRON_SECRET / x-cron-secret)
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!igConfigured()) {
    return NextResponse.json({ ok: true, configured: false, note: 'Instagram連携env未設定のためスキップ' });
  }

  const now = nowUtcIso();
  const due = await getOne(
    `SELECT id, title, video_path, cover_path, caption FROM reel_queue
     WHERE status = 'scheduled' AND scheduled_at <= ?
     ORDER BY scheduled_at ASC LIMIT 1`,
    [now]
  );
  if (!due) {
    return NextResponse.json({ ok: true, posted: false, note: '期限が来たリールなし' });
  }

  // claim (多重発火ガード): scheduled のままの時だけ posting に遷移できる
  const claim = await execute(
    `UPDATE reel_queue SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'scheduled'`,
    [now, due.id]
  );
  if ((claim.rowsAffected ?? 0) === 0) {
    return NextResponse.json({ ok: true, posted: false, note: `#${due.id} は別プロセスが処理中` });
  }

  try {
    await refreshTokenIfStale();
  } catch {
    // トークン更新失敗は公開試行を止めない(まだ有効な可能性)
  }

  const origin = new URL(req.url).origin;
  const videoUrl = `${origin}${due.video_path}`;
  const coverUrl = due.cover_path ? `${origin}${due.cover_path}` : undefined;

  try {
    const { mediaId, permalink } = await publishReel(videoUrl, String(due.caption), coverUrl);
    await execute(
      `UPDATE reel_queue SET status = 'posted', ig_media_id = ?, permalink = ?, posted_at = ?, updated_at = ? WHERE id = ?`,
      [mediaId, permalink ?? null, nowUtcIso(), nowUtcIso(), due.id]
    );
    return NextResponse.json({ ok: true, posted: true, id: due.id, mediaId, permalink });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await execute(
      `UPDATE reel_queue SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`,
      [msg.slice(0, 500), nowUtcIso(), due.id]
    );
    return NextResponse.json({ ok: false, posted: false, id: due.id, error: msg }, { status: 500 });
  }
}
