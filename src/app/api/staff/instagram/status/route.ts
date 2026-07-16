import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { configured, connectionStatus } from '@/lib/instagram';
import { todayJst, weekdayJst, shiftDays } from '@/lib/dateJst';
import { findChainMedia, loadSidecar, checkSchedule } from '@/lib/storyPlan';
import { peekNextQueueItem } from '@/lib/storyQueue';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const status = await connectionStatus();
  const [logs, queue] = await Promise.all([
    getAll(
      'SELECT date, weekday, video_path, status, ig_media_id, error, created_at FROM story_post_log ORDER BY id DESC LIMIT 14'
    ),
    getAll(
      `SELECT id, media_path, media_type, kind, title, valid_from, valid_until, status, last_posted_at, times_posted
       FROM story_queue
       WHERE status IN ('pending', 'approved')
       ORDER BY status DESC, id ASC` // pending を先に(承認待ちが上)
    ),
  ]);

  // 明日の投稿予定: cronと同じ優先チェーンを明日の日付で評価する(読み取りのみ・投稿はしない)。
  // 「寝る前に明日何が出るか確認できる」ためのプレビュー。
  const tomorrow = shiftDays(todayJst(), 1);
  const tomorrowWeekday = weekdayJst(tomorrow);
  const origin = new URL(req.url).origin;
  const chain = await findChainMedia(origin, tomorrow, tomorrowWeekday);
  const sidecar = chain ? await loadSidecar(origin, chain.base) : {};
  const check = chain ? await checkSchedule(tomorrow, sidecar.lessons) : null;

  let plan;
  if (chain && check?.result !== 'mismatch') {
    plan = {
      date: tomorrow,
      weekday: tomorrowWeekday,
      source: chain.source,
      mediaPath: new URL(chain.url).pathname,
      mediaType: chain.type,
      mentions: sidecar.mentions ?? [],
      scheduleCheck: check, // no-declaration | match
    };
  } else {
    // 素材なし、またはスケジュール不一致 → 埋め草キューへフォールバック
    const queueItem = await peekNextQueueItem(tomorrow);
    const mismatch =
      check?.result === 'mismatch'
        ? { skippedMediaPath: chain ? new URL(chain.url).pathname : null, declared: check.declared, actual: check.actual }
        : undefined;
    plan = queueItem
      ? {
          date: tomorrow,
          weekday: tomorrowWeekday,
          source: 'queue' as const,
          mediaPath: queueItem.media_path,
          mediaType: queueItem.media_type,
          mentions: [] as string[],
          queueTitle: queueItem.title,
          mismatch,
        }
      : { date: tomorrow, weekday: tomorrowWeekday, source: 'none' as const, mismatch };
  }

  return NextResponse.json({
    envConfigured: configured(),
    ...status,
    logs,
    queue,
    plan,
  });
}
