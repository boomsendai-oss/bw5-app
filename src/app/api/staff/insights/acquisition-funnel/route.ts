import { NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { withAuth } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { getAdCost, getLineClickCount, monthRange } from '@/lib/ga4';
import {
  buildMonthlyFunnel,
  buildReferralBreakdown,
  type FunnelTrialRow,
} from '@/lib/acquisitionFunnel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// GET /api/staff/insights/acquisition-funnel
//   集客ファネル(広告費→LINEクリック→体験→入会)を月次と流入経路別で返す。
export const GET = withAuth(async () => {
  try {
    const today = todayJst();
    const rows = (await getAll(
      `SELECT reserved_at, status, attendance_override, enrolled_after, referral_source
         FROM trial_records`
    )) as FunnelTrialRow[];

    const monthly = buildMonthlyFunnel(rows, today).slice(-6);
    const referral = buildReferralBreakdown(rows, today);

    // 当月の広告費 (GA4)。GA4は数時間〜1日遅れる。
    const ym = today.slice(0, 7);
    const { startDate, endDate } = monthRange(ym);
    const [adCost, lineClicks] = await Promise.all([
      getAdCost(startDate, endDate),
      getLineClickCount(startDate, endDate),
    ]);

    return NextResponse.json({
      ok: true,
      today,
      month: ym,
      monthly,
      referral,
      ad: {
        available: adCost.available,
        error: adCost.error,
        cost: adCost.cost,
        clicks: adCost.clicks,
        currency: adCost.currency,
      },
      line_clicks_month: {
        available: lineClicks.available,
        error: lineClicks.error,
        total: lineClicks.total,
        ads: lineClicks.ads,
      },
    });
  } catch (e) {
    console.error('[acquisition-funnel GET]', e);
    return NextResponse.json({ error: '集客ファネルの取得に失敗しました' }, { status: 500 });
  }
});
