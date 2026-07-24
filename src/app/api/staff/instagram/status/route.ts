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

  // 投稿パフォーマンス: media_insights の各投稿の最新スナップショット(collect-insights cronが毎日貯める)。
  // SQLiteのmax()+bare column規則で、MAX(collected_date)の行の値がそのまま返る。
  // テーブル未適用(migration前)でも画面を落とさないため catch で空配列にフォールバック。
  const insights = await getAll(
    `SELECT media_id, kind, title, posted_at, MAX(collected_date) AS collected_date,
            reach, views, likes, comments, shares, saved, total_interactions
     FROM media_insights GROUP BY media_id ORDER BY posted_at DESC LIMIT 20`
  ).catch(() => []);

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
    insights,
  });
}

/** 1日分の投稿予定を評価(cronと同じ選択・照合ロジックを読み取り専用で) */
async function buildPlanForDate(origin: string, date: string) {
  const weekday = weekdayJst(date);
  const chainList = await findChainMediaList(origin, date, weekday);

  if (chainList.length > 0) {
    const items = [];
    for (const media of chainList) {
      // library-auto は台帳(manifest)の宣言/メンションをmediaが直接持つ(sidecar {base}.json は無い)
      const sidecar = media.source === 'library-auto'
        ? { lessons: media.lessons, mentions: media.mentions }
        : await loadSidecar(origin, media.base);
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
