import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { todayJst, weekdayJst } from '@/lib/dateJst';
import { configured as igConfigured, publishStoryVideo, refreshTokenIfStale } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// 日次ストーリー自動投稿 (毎朝 JST 8:00 に GitHub Actions cron から叩かれる)。
// 8時=全曜日レッスン前＋フォロワー朝の活動帯。「今日のレッスン」告知を朝に出す方針。
// 認証: Authorization: Bearer <CRON_SECRET> または x-cron-secret ヘッダ (gbp-reviewsと同パターン)
function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const bearer = req.headers.get('authorization');
  if (bearer === `Bearer ${secret}`) return true;
  if (req.headers.get('x-cron-secret') === secret) return true;
  return false;
}

const WEEKDAY_FILES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

async function logResult(date: string, weekday: number, videoPath: string | null, status: string, igMediaId?: string, error?: string) {
  await execute(
    'INSERT INTO story_post_log (date, weekday, video_path, status, ig_media_id, error) VALUES (?, ?, ?, ?, ?, ?)',
    [date, weekday, videoPath, status, igMediaId ?? null, error ?? null]
  );
}

export async function POST(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const date = todayJst();
  const weekday = weekdayJst(date); // TZ安全(サーバーUTCでも1日ズレない)
  const fileName = `${WEEKDAY_FILES[weekday]}.mp4`;

  if (!igConfigured()) {
    // Meta App env未設定の間はno-opで成功扱い (cron自体は先に稼働させておく)
    await logResult(date, weekday, null, 'skipped_not_configured');
    return NextResponse.json({ ok: true, configured: false, note: 'Instagram連携env未設定のためスキップ' });
  }

  // 冪等性: 同じ日に既に投稿済みなら再投稿しない。
  // (手動テストと定時cronの重複、GH Actionsのリトライ、二重発火から二重ストーリーを防ぐ)
  const already = await getOne(
    "SELECT 1 AS hit FROM story_post_log WHERE date = ? AND status = 'posted' LIMIT 1",
    [date]
  );
  if (already) {
    return NextResponse.json({ ok: true, posted: false, note: `${date} は投稿済みのためスキップ(冪等)` });
  }

  const origin = new URL(req.url).origin;
  const videoUrl = `${origin}/stories/${fileName}`;

  // 動画が用意されているか確認 (未生成の曜日はまだ多い→静かにスキップ)
  const head = await fetch(videoUrl, { method: 'HEAD' }).catch(() => null);
  if (!head || !head.ok) {
    await logResult(date, weekday, videoUrl, 'skipped_no_video');
    return NextResponse.json({ ok: true, posted: false, note: `${fileName} が未生成のためスキップ` });
  }

  try {
    await refreshTokenIfStale();
    const { mediaId } = await publishStoryVideo(videoUrl);
    await logResult(date, weekday, videoUrl, 'posted', mediaId);
    return NextResponse.json({ ok: true, posted: true, mediaId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logResult(date, weekday, videoUrl, 'error', undefined, msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
