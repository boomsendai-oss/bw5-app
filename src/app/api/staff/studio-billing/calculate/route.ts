import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { calculateStudioBillingForMonth, persistStudioBillingRun } from '@/lib/studioBilling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month as string | undefined;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return NextResponse.json({ error: 'year_month required (YYYY-MM)' }, { status: 400 });
  const { results, payment_dates } = await calculateStudioBillingForMonth(ym);
  const ids: { studio_id: number; run_id: number; total_amount: number }[] = [];
  for (const r of results) {
    if (r.lines.length === 0) continue;
    const runId = await persistStudioBillingRun(ym, r, payment_dates[r.studio_id]);
    ids.push({ studio_id: r.studio_id, run_id: runId, total_amount: r.total_lesson_amount });
  }
  return NextResponse.json({ year_month: ym, calculated: ids.length, runs: ids });
}
