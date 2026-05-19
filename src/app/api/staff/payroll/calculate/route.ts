import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { calculatePayrollForMonth, persistPayrollRun } from '@/lib/payroll';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/payroll/calculate { year_month: 'YYYY-MM' }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month as string | undefined;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month is required (YYYY-MM)' }, { status: 400 });
  }
  const { payment_date, results } = await calculatePayrollForMonth(ym);
  const ids: { instructor_id: number; run_id: number; total_amount: number }[] = [];
  for (const r of results) {
    if (r.total_lesson_amount === 0 && r.total_transit_amount === 0 && r.salary_type !== 'monthly_fixed') continue;
    const runId = await persistPayrollRun(ym, r, payment_date);
    ids.push({
      instructor_id: r.instructor_id,
      run_id: runId,
      total_amount: r.total_lesson_amount + r.total_transit_amount,
    });
  }
  return NextResponse.json({ year_month: ym, payment_date, calculated: ids.length, runs: ids });
}
