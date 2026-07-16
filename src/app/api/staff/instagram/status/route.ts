import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { configured, connectionStatus } from '@/lib/instagram';
import { todayJst, weekdayJst, shiftDays } from '@/lib/dateJst';
import { findChainMedia, loadMentions } from '@/lib/storyPlan';
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
  let plan;
  if (chain) {
    const mentions = await loadMentions(origin, chain.base);
    plan = {
      date: tomorrow,
      weekday: tomorrowWeekday,
      source: chain.source,
      mediaPath: new URL(chain.url).pathname,
      mediaType: chain.type,
      mentions: mentions ?? [],
    };
  } else {
    const queueItem = await peekNextQueueItem(tomorrow);
    plan = queueItem
      ? {
          date: tomorrow,
          weekday: tomorrowWeekday,
          source: 'queue' as const,
          mediaPath: queueItem.media_path,
          mediaType: queueItem.media_type,
          mentions: [] as string[],
          queueTitle: queueItem.title,
        }
      : { date: tomorrow, weekday: tomorrowWeekday, source: 'none' as const };
  }

  return NextResponse.json({
    envConfigured: configured(),
    ...status,
    logs,
    queue,
    plan,
  });
}
