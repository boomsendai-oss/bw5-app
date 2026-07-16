import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { configured, connectionStatus } from '@/lib/instagram';
import { todayJst, weekdayJst, shiftDays } from '@/lib/dateJst';
import { findChainMediaList, loadSidecar, checkSchedule } from '@/lib/storyPlan';
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
  const chainList = await findChainMediaList(origin, tomorrow, tomorrowWeekday);

  let plan;
  if (chainList.length > 0) {
    // 通常素材あり(複数スロット対応): 各スロットを正本カレンダーと照合した結果を返す
    const items = [];
    for (const media of chainList) {
      const sidecar = await loadSidecar(origin, media.base);
      const check = await checkSchedule(tomorrow, sidecar.lessons);
      items.push({
        base: media.base,
        mediaPath: new URL(media.url).pathname,
        mediaType: media.type,
        mentions: sidecar.mentions ?? [],
        scheduleCheck: check,
      });
    }
    plan = { date: tomorrow, weekday: tomorrowWeekday, source: chainList[0].source, items };
  } else {
    // 素材なし → 埋め草キューのプレビュー
    const queueItem = await peekNextQueueItem(tomorrow);
    plan = queueItem
      ? {
          date: tomorrow,
          weekday: tomorrowWeekday,
          source: 'queue' as const,
          items: [
            {
              base: `queue#${queueItem.id}`,
              mediaPath: queueItem.media_path,
              mediaType: queueItem.media_type,
              mentions: [] as string[],
              scheduleCheck: null,
              queueTitle: queueItem.title,
            },
          ],
        }
      : { date: tomorrow, weekday: tomorrowWeekday, source: 'none' as const, items: [] };
  }

  return NextResponse.json({
    envConfigured: configured(),
    ...status,
    logs,
    queue,
    plan,
  });
}
