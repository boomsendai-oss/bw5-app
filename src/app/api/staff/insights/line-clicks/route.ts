import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getLineClickStats, GA4_MEASUREMENT_START, ADS_DAILY_BUDGET_JPY } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/line-clicks
//   GA4の line_click イベント集計 (直近7日/30日、総数と google/cpc 経由)。
//   lib/ga4.ts 側で1時間キャッシュ (GA4自体が数時間遅れのためこれで十分)。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const force = new URL(req.url).searchParams.get('force') === '1';
  const stats = await getLineClickStats(force);

  // CPA概算: キャンペーン日予算 × 経過日数 ÷ 広告経由クリック数
  // 計測/出稿開始(2026-06-10)以前は日数に数えない
  const startMs = new Date(GA4_MEASUREMENT_START + 'T00:00:00+09:00').getTime();
  const elapsedDays = Math.max(1, Math.floor((Date.now() - startMs) / 86400000) + 1);

  const ranges = stats.ranges.map((r) => {
    const billedDays = Math.min(r.days, elapsedDays);
    const cost = billedDays * ADS_DAILY_BUDGET_JPY;
    return {
      ...r,
      est_cost_jpy: cost,
      est_cpa_jpy: r.ads > 0 ? Math.round(cost / r.ads) : null,
    };
  });

  return NextResponse.json({
    ok: stats.available,
    error: stats.error,
    measurement_start: GA4_MEASUREMENT_START,
    daily_budget_jpy: ADS_DAILY_BUDGET_JPY,
    ranges,
    fetched_at: stats.fetchedAt,
  });
}
