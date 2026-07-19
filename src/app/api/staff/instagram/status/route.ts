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
      'SELECT date, weekday, video_path, status, ig_media_id, error, created_at, mentions_applied, mentions_failed FROM story_post_log ORDER BY id DESC LIMIT 14'
    ),
    getAll(
      `SELECT id, media_path, media_type, kind, title, valid_from, valid_until, status, last_posted_at, times_posted
       FROM story_queue
       WHERE status IN ('pending', 'approved')
       ORDER BY status DESC, id ASC` // pending を先に(承認待ちが上)
    ),
  ]);

  // 向こう1週間の投稿予定: cronと同じ優先チェーンを今日〜6日後で評価する(読み取りのみ・投稿はしない)。
  // 今日分は投稿済みかどうかを画面側でログと突き合わせて表示する。
  const origin = new URL(req.url).origin;
  const today = todayJst();
  const plans = await Promise.all(
    Array.from({ length: 7 }, (_, i) => buildPlanForDate(origin, shiftDays(today, i)))
  );

  return NextResponse.json({
    envConfigured: configured(),
    ...status,
    logs,
    queue,
    plans,
  });
}

/** 1日分の投稿予定を評価(cronと同じ選択・照合ロジックを読み取り専用で) */
async function buildPlanForDate(origin: string, date: string) {
  const weekday = weekdayJst(date);
  const chainList = await findChainMediaList(origin, date, weekday);

  if (chainList.length > 0) {
    const items = [];
    for (const media of chainList) {
      const sidecar = await loadSidecar(origin, media.base);
      const check = await checkSchedule(date, sidecar.lessons);
      items.push({
        base: media.base,
        mediaPath: new URL(media.url).pathname,
        mediaType: media.type,
        mentions: sidecar.mentions ?? [],
        scheduleCheck: check,
      });
    }
    return { date, weekday, source: chainList[0].source, items };
  }
  // 素材なし → 埋め草キューのプレビュー(キュー消化は日々変わるため先の日付ほど参考値)
  const queueItem = await peekNextQueueItem(date);
  return queueItem
    ? {
        date,
        weekday,
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
    : { date, weekday, source: 'none' as const, items: [] };
}
