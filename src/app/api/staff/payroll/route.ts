import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/payroll?year_month=YYYY-MM
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  if (!ym) {
    // 過去6ヶ月のサマリ
    const runs = await getAll(
      `SELECT year_month, COUNT(*) AS instructors, SUM(total_amount) AS total, status, MAX(payment_date) AS payment_date
       FROM payroll_runs
       GROUP BY year_month
       ORDER BY year_month DESC
       LIMIT 12`
    );
    return NextResponse.json({ months: runs });
  }
  const runs = await getAll(
    `SELECT pr.*, i.name AS instructor_name, i.salary_type, i.payslip_folder_url
     FROM payroll_runs pr
     LEFT JOIN instructors i ON i.id = pr.instructor_id
     WHERE pr.year_month = ?
     ORDER BY i.name`,
    [ym]
  );
  return NextResponse.json({ year_month: ym, runs });
}
