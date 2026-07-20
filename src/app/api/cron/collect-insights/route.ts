import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute } from '@/lib/db';
import { todayJst, nowUtcIso, shiftDays } from '@/lib/dateJst';
import { configured, fetchMediaInsights } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/collect-insights
// 投稿パフォーマンス(リーチ/再生/保存など)を毎日1回自動で貯める。
// 「一定期間運用してデータを見て再計画する」を人手のIGアプリ目視に頼らないための土台。
//   - リール: 投稿後30日間、毎日スナップショット(数日かけて数字が伸びるため初速も見える)
//   - ストーリー: 投稿後3日間(24hで消えるが直後の数字を確実に押さえる)
// (media_id, collected_date) のUNIQUEで1日1行にupsert=再実行しても増殖しない。
// 認証: Bearer CRON_SECRET または x-cron-secret(GH Actionsから)。
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  const bearerOk = req.headers.get('authorization') === `Bearer ${secret}`;
  const xcronOk = req.headers.get('x-cron-secret') === secret;
  if (!bearerOk && !xcronOk) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (!configured()) {
    return NextResponse.json({ ok: true, configured: false });
  }

  const collectedDate = todayJst();
  const collectedAt = nowUtcIso();
  const cutoffReel = new Date(Date.now() - 30 * 86400000).toISOString();
  // ストーリーは24hで消え、期限切れ後はインサイトが取れない(全項目null)。
  // 毎朝4時の収集で「前日の朝に出したストーリー」を約20時間後に拾えるため、今日+昨日で十分。
  const cutoffStory = shiftDays(collectedDate, -1);

  type Target = { mediaId: string; kind: 'reel' | 'story'; title: string; postedAt: string | null };
  const targets: Target[] = [];

  const reels = await getAll(
    "SELECT title, ig_media_id, posted_at FROM reel_queue WHERE status = 'posted' AND ig_media_id IS NOT NULL AND (posted_at IS NULL OR posted_at >= ?)",
    [cutoffReel]
  );
  for (const r of reels) {
    targets.push({
      mediaId: String(r.ig_media_id),
      kind: 'reel',
      title: String(r.title ?? 'リール'),
      postedAt: r.posted_at ? String(r.posted_at) : null,
    });
  }

  const stories = await getAll(
    "SELECT date, video_path, ig_media_id, created_at FROM story_post_log WHERE status = 'posted' AND ig_media_id IS NOT NULL AND date >= ?",
    [cutoffStory]
  );
  for (const s of stories) {
    targets.push({
      mediaId: String(s.ig_media_id),
      kind: 'story',
      title: `ストーリー ${s.date} ${String(s.video_path ?? '').split('/').pop() ?? ''}`.trim(),
      postedAt: s.created_at ? String(s.created_at) : null,
    });
  }

  let saved = 0;
  let pending = 0;
  const errors: string[] = [];

  for (const t of targets) {
    try {
      const ins = await fetchMediaInsights(t.mediaId, t.kind);
      if (!ins) {
        pending++; // 未集計(投稿直後)や取得不可。翌日以降のcronで再取得される
        continue;
      }
      // 数値が1つも取れない = 期限切れストーリー等。空行を貯めても判断材料にならないので保存しない。
      const hasValue = [
        ins.reach, ins.views, ins.likes, ins.comments, ins.shares, ins.saved, ins.replies, ins.total_interactions,
      ].some((v) => typeof v === 'number');
      if (!hasValue) {
        pending++;
        continue;
      }
      await execute(
        `INSERT INTO media_insights
           (media_id, kind, title, posted_at, collected_date, collected_at, reach, views, likes, comments, shares, saved, replies, total_interactions, raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(media_id, collected_date) DO UPDATE SET
           title = excluded.title, posted_at = excluded.posted_at, collected_at = excluded.collected_at,
           reach = excluded.reach, views = excluded.views, likes = excluded.likes, comments = excluded.comments,
           shares = excluded.shares, saved = excluded.saved, replies = excluded.replies,
           total_interactions = excluded.total_interactions, raw = excluded.raw`,
        [
          t.mediaId, t.kind, t.title, t.postedAt, collectedDate, collectedAt,
          ins.reach ?? null, ins.views ?? null, ins.likes ?? null, ins.comments ?? null,
          ins.shares ?? null, ins.saved ?? null, ins.replies ?? null, ins.total_interactions ?? null,
          ins.raw,
        ]
      );
      saved++;
    } catch (e) {
      errors.push(`${t.kind} ${t.mediaId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  return NextResponse.json({
    ok: errors.length === 0,
    collectedDate,
    targets: targets.length,
    saved,
    pending,
    errors,
  });
}
