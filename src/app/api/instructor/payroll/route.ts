import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { getInstructorBySession } from '@/lib/instructorAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/instructor/payroll?year_month=YYYY-MM (optional)
// 自分の給与明細を返す。year_month指定なし → 過去12ヶ月分のサマリ
export async function GET(req: NextRequest) {
  const me = await getInstructorBySession(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');

  if (!ym) {
    const runs = await getAll(
      `SELECT id, year_month, total_lesson_amount, total_transit_amount, total_adjustment_amount, total_amount, payment_date, status, pdf_url
       FROM payroll_runs WHERE instructor_id = ? AND status IN ('confirmed', 'paid')
       ORDER BY year_month DESC LIMIT 12`,
      [me.id]
    );
    return NextResponse.json({ runs });
  }

  const run = (await getAll(
    `SELECT * FROM payroll_runs WHERE instructor_id = ? AND year_month = ? AND status IN ('confirmed', 'paid')`,
    [me.id, ym]
  ))[0];
  if (!run) return NextResponse.json({ error: 'not found or not confirmed' }, { status: 404 });
  const lines = await getAll(`SELECT * FROM payroll_lines WHERE payroll_run_id = ? ORDER BY lesson_date`, [run.id]);
  const adjustments = await getAll(`SELECT * FROM payroll_adjustments WHERE payroll_run_id = ? ORDER BY created_at`, [run.id]);
  return NextResponse.json({ run, lines, adjustments });
}
