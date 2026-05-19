import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const METRICS = ['members_active', 'monthly_revenue', 'line_friends', 'trial_count', 'trial_cvr', 'utilization', 'churn_rate', 'operating_profit'];

// GET /api/staff/kpi/targets?year_month=YYYY-MM
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  if (!ym) return NextResponse.json({ error: 'year_month required' }, { status: 400 });
  const rows = await getAll(`SELECT metric_key, target_value, notes FROM kpi_targets WHERE year_month = ?`, [ym]);
  const map: Record<string, number> = {};
  for (const r of rows) map[r.metric_key as string] = Number(r.target_value);
  return NextResponse.json({ year_month: ym, targets: map, available_metrics: METRICS });
}

// POST /api/staff/kpi/targets
// body: { year_month, targets: { metric_key: value, ... } }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month required' }, { status: 400 });
  if (!body.targets || typeof body.targets !== 'object') return NextResponse.json({ error: 'targets object required' }, { status: 400 });
  let saved = 0;
  for (const [key, value] of Object.entries(body.targets)) {
    if (!METRICS.includes(key)) continue;
    const v = Number(value);
    if (isNaN(v)) continue;
    await execute(
      `INSERT INTO kpi_targets (metric_key, year_month, target_value) VALUES (?, ?, ?)
       ON CONFLICT(metric_key, year_month) DO UPDATE SET target_value = excluded.target_value`,
      [key, ym, v]
    );
    saved++;
  }
  return NextResponse.json({ ok: true, saved });
}
