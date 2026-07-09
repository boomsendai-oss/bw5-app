import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { calculatePayrollForMonth, persistPayrollRun, zeroStaleDraftPayrollRuns } from '@/lib/payroll';

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
  // 単価未登録でサイレント¥0になっている講師を警告として返す(T-156)
  const warnings: { instructor_id: number; instructor_name: string; reason: string }[] = [];
  for (const r of results) {
    // 単価未登録の行があるのに合計0で消える講師は「サイレント¥0=未払い」になる。
    // skipせず警告に積み、確定前に気づけるようにする。
    if (r.has_rate_missing) {
      warnings.push({
        instructor_id: r.instructor_id,
        instructor_name: r.instructor_name,
        reason: `レッスンはあるが単価が未登録の行があります(¥0計上の恐れ)。instructor_rates を確認してください`,
      });
    }
    // M2: 実時間バケット欠落で master分数バケットに代用計上した(延長分の単価要登録)
    if (r.has_bucket_fallback) {
      warnings.push({
        instructor_id: r.instructor_id,
        instructor_name: r.instructor_name,
        reason: `実時間の単価が未登録のため、master設定分数の単価で代用計上しました。延長分の単価バケットを登録してください`,
      });
    }
    // 純粋に0(単価未登録もなく実績もない)講師は従来通りskip。
    // ただし rate_missing がある場合はskipせず run を残して可視化する。
    if (
      r.total_lesson_amount === 0 &&
      r.total_transit_amount === 0 &&
      r.salary_type !== 'monthly_fixed' &&
      !r.has_rate_missing
    ) {
      continue;
    }
    const runId = await persistPayrollRun(ym, r, payment_date);
    ids.push({
      instructor_id: r.instructor_id,
      run_id: runId,
      total_amount: r.total_lesson_amount + r.total_transit_amount,
    });
  }
  // 今回 run を作らなかった講師の残置 draft を0円化(誤支給防止 A-2)
  const zeroed = await zeroStaleDraftPayrollRuns(ym, ids.map((i) => i.instructor_id));
  return NextResponse.json({ year_month: ym, payment_date, calculated: ids.length, runs: ids, warnings, zeroed_stale_drafts: zeroed });
}
