import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getAll } from '@/lib/db';
import { configured, connectionStatus } from '@/lib/instagram';
import {
  configured as threadsConfigured,
  connectionStatus as threadsConnectionStatus,
} from '@/lib/threads';
import {
  configured as fbConfigured,
  connectionStatus as fbConnectionStatus,
} from '@/lib/facebookPage';
import {
  configured as tiktokConfigured,
  connectionStatus as tiktokConnectionStatus,
} from '@/lib/tiktok';
import { todayJst, weekdayJst, shiftDays } from '@/lib/dateJst';
import { findChainMediaList, loadSidecar, checkSchedule } from '@/lib/storyPlan';
import { peekNextQueueItem } from '@/lib/storyQueue';
import { getDayPlans, listDaySlotsFor, type DayPlan, type DaySlot } from '@/lib/storyDayPlan';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const status = await connectionStatus();
  // 横展開先はどれも別アプリ・別トークン(instagram.tsのトークンは使えない)。連携状態も別に出す
  const [threads, facebook, tiktok] = await Promise.all([
    threadsConnectionStatus(),
    fbConnectionStatus(),
    tiktokConnectionStatus(),
  ]);
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
  const dates = Array.from({ length: 7 }, (_, i) => shiftDays(today, i));
  const dayPlans = await getDayPlans(dates);
  const daySlots = await listDaySlotsFor(dates);
  const plans = await Promise.all(
    dates.map((d) => buildPlanForDate(origin, d, dayPlans[d] ?? null, daySlots[d] ?? []))
  );

  return NextResponse.json({
    envConfigured: configured(),
    threadsEnvConfigured: threadsConfigured(),
    facebookEnvConfigured: fbConfigured(),
    tiktokEnvConfigured: tiktokConfigured(),
    ...threads,
    ...facebook,
    ...tiktok,
    ...status,
    logs,
    queue,
    plans,
    insights,
  });
}

/**
 * 1日分の投稿予定を評価(cronと同じ選択・照合ロジックを読み取り専用で)。
 * verdict = その日の結論。画面はこれ1つ見れば「投稿されるのか」が分かる(TARO 2026-08-03)。
 *   'skip'     … アプリで「投稿しない」に設定済み
 *   'will-post'… 投稿される(itemsの本数だけ)
 *   'blocked'  … 素材はあるがカレンダー不一致で全部止まる
 *   'no-media' … 出せる素材が無い
 */
async function buildPlanForDate(origin: string, date: string, dayPlan: DayPlan | null, slots: DaySlot[]) {
  const weekday = weekdayJst(date);

  // 枠(slot)は通常の投稿に「足す」もの。画面でも同じ扱いにして、実際の投稿と一致させる。
  const slotItems = slots.map((sl) => ({
    base: `slot:${date}:${sl.slotTime}`,
    mediaPath: sl.mediaPath,
    mediaType: sl.mediaType,
    mentions: [] as string[],
    scheduleCheck: null,
    pinned: true,
    slotTime: sl.slotTime,
  }));

  if (dayPlan?.mode === 'skip') {
    return { date, weekday, source: 'none' as const, verdict: 'skip' as const, dayPlan, slots, items: [] };
  }
  if (dayPlan?.mode === 'pin' && dayPlan.mediaPath) {
    return {
      date, weekday, source: 'date-file' as const, verdict: 'will-post' as const, dayPlan, slots,
      items: [{
        base: `pin:${date}`,
        mediaPath: dayPlan.mediaPath,
        mediaType: dayPlan.mediaType ?? 'image',
        mentions: [] as string[],
        scheduleCheck: null,
        pinned: true,
      }, ...slotItems],
    };
  }

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
    const all = [...items, ...slotItems];
    const postable = all.filter((i) => i.scheduleCheck?.result !== 'mismatch');
    return {
      date, weekday, source: chainList[0].source, dayPlan, slots,
      verdict: postable.length > 0 ? ('will-post' as const) : ('blocked' as const),
      items: all,
    };
  }
  // 枠を置いた日は埋め草を混ぜない(cronと同じ判断)
  if (slotItems.length > 0) {
    return { date, weekday, source: 'date-file' as const, verdict: 'will-post' as const, dayPlan, slots, items: slotItems };
  }
  // 素材なし → 埋め草キューのプレビュー(キュー消化は日々変わるため先の日付ほど参考値)
  const queueItem = await peekNextQueueItem(date);
  return queueItem
    ? {
        date,
        weekday,
        source: 'queue' as const,
        verdict: 'will-post' as const,
        dayPlan,
        slots,
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
    : { date, weekday, source: 'none' as const, verdict: 'no-media' as const, dayPlan, slots, items: [] };
}
