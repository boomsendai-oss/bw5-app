import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getLineClickStats, getAdCost, GA4_MEASUREMENT_START } from '@/lib/ga4';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/line-clicks
//   GA4の line_click イベント集計 (直近7日/30日、総数と google/cpc 経由) と、
//   同期間のGoogle広告の実費用。
//
//   以前は日予算の決め打ち(¥200)×経過日数でCPAを概算していたが、実際の日予算は
//   ¥1,000でありCPAが実態の約1/5に過小表示されていた (WS AA / 2026-07-27)。
//   GA4に実費用(advertiserAdCost)が入っているのでそれを使う。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const force = new URL(req.url).searchParams.get('force') === '1';
  const [stats, cost7, cost30] = await Promise.all([
    getLineClickStats(force),
    getAdCost('7daysAgo', 'today'),
    getAdCost('30daysAgo', 'today'),
  ]);

  // キーは getLineClickStats が返す ranges の days と一致させること。
  // 未知の days が来た場合はエラーにせず cost_jpy: null に落ちる (下の `c?.available` 参照)。
  const costByDays: Record<number, { cost: number; available: boolean }> = {
    7: { cost: cost7.cost, available: cost7.available },
    30: { cost: cost30.cost, available: cost30.available },
  };

  const ranges = stats.ranges.map((r) => {
    const c = costByDays[r.days];
    const cost = c?.available ? Math.round(c.cost) : null;
    return {
      ...r,
      cost_jpy: cost,
      cpa_jpy: cost != null && r.ads > 0 ? Math.round(cost / r.ads) : null,
    };
  });

  return NextResponse.json({
    ok: stats.available,
    error: stats.error ?? cost30.error,
    measurement_start: GA4_MEASUREMENT_START,
    ranges,
    fetched_at: stats.fetchedAt,
  });
}
