import { execute, getAll, getOne } from './db';
import { isMonthConfirmed } from './monthConfirm';
import {
  calcPaymentDate,
  minutesBetween,
  aggregateInstances,
  expandMasters,
  buildResultsMap,
  applyMonthlyFixed,
  sortLinesByDate,
} from './payroll-calc';

// 型を payroll-calc.ts から re-export (既存の import 元を壊さない)
export type { PayrollLine, PayrollResult } from './payroll-calc';
import type { PayrollResult } from './payroll-calc';

// 月内のレッスン実績(休講除く)を集計してインストラクター別給与を計算
export async function calculatePayrollForMonth(yearMonth: string): Promise<{ payment_date: string; results: import('./payroll-calc').PayrollResult[] }> {
  const [y, m] = yearMonth.split('-').map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

  type InstructorRow = {
    id: number; name: string;
    salary_type: string | null;
    monthly_fixed_amount: number | null;
  };
  const instructors = (await getAll(
    `SELECT id, name, salary_type, monthly_fixed_amount FROM instructors WHERE active = 1`
  )) as InstructorRow[];

  type RateRow = { instructor_id: number; duration_minutes: number; rate: number };
  const rates = (await getAll(`SELECT instructor_id, duration_minutes, rate FROM instructor_rates`)) as RateRow[];
  const rateMap = new Map<string, number>();
  for (const r of rates) rateMap.set(`${r.instructor_id}_${r.duration_minutes}`, r.rate);

  type TransitRow = { instructor_id: number; studio_id: number; amount: number };
  const transitFees = (await getAll(`SELECT instructor_id, studio_id, amount FROM instructor_transit_fees`)) as TransitRow[];
  const transitMap = new Map<string, number>();
  for (const t of transitFees) transitMap.set(`${t.instructor_id}_${t.studio_id}`, t.amount);

  type InstanceRow = {
    id: number; date: string; start_time: string; end_time: string;
    instructor_id: number | null; studio_id: number | null;
    master_id: number | null; status: string;
    class_name: string | null; studio_name: string | null; duration_minutes: number | null;
    transit_fee_override: number | null;
  };
  // 休講(cancelled)も含めて全インスタンスを取得する。
  const instances = (await getAll(
    `SELECT li.*, lm.class_name, s.name AS studio_name, lm.duration_minutes
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     LEFT JOIN studios s ON s.id = li.studio_id
     WHERE li.date BETWEEN ? AND ?`,
    [monthStart, monthEnd]
  )) as InstanceRow[];

  type MasterRow = {
    id: number; class_name: string;
    default_day_of_week: number; default_start_time: string; default_end_time: string;
    duration_minutes: number | null; override_rate: number | null;
    default_instructor_id: number | null; default_studio_id: number | null;
    studio_name: string | null;
    start_date: string | null; end_date: string | null;
  };
  const masters = (await getAll(
    `SELECT lm.id, lm.class_name, lm.default_day_of_week, lm.default_start_time, lm.default_end_time,
            lm.duration_minutes, lm.override_rate, lm.default_instructor_id, lm.default_studio_id,
            lm.start_date, lm.end_date,
            s.name AS studio_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     WHERE lm.active = 1`
  )) as MasterRow[];

  // master の override_rate (特別単価) マップ
  const masterOverrideMap = new Map<number, number | null>();
  for (const mm of masters) masterOverrideMap.set(mm.id, mm.override_rate);

  const resultsMap = buildResultsMap(instructors);

  // 1) lesson_instances から確定分を計上
  const expandedKeys = new Set<string>();
  const transitCharged = new Set<string>();
  aggregateInstances(instances, resultsMap, masterOverrideMap, rateMap, transitMap, expandedKeys, transitCharged);

  // 2) lesson_master 週次展開 (instances にない日を埋める)
  const confirmed = await isMonthConfirmed(yearMonth);
  if (!confirmed) {
    expandMasters(yearMonth, masters, resultsMap, rateMap, transitMap, expandedKeys, transitCharged);
  }

  // 3) monthly_fixed の人は固定額をlesson_amountに
  applyMonthlyFixed(instructors, resultsMap);

  // 日付順ソート
  sortLinesByDate(resultsMap);

  return {
    payment_date: calcPaymentDate(yearMonth),
    results: Array.from(resultsMap.values()),
  };
}

// 計算結果をpayroll_runs / payroll_linesにUPSERTで永続化
export async function persistPayrollRun(yearMonth: string, result: PayrollResult, paymentDate: string): Promise<number> {
  const existing = await getOne(
    `SELECT id, status FROM payroll_runs WHERE year_month = ? AND instructor_id = ?`,
    [yearMonth, result.instructor_id]
  );
  if (existing && existing.status !== 'draft') {
    return existing.id as number;
  }

  const adjustments = existing
    ? ((await getAll(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM payroll_adjustments WHERE payroll_run_id = ?`,
        [existing.id]
      )) as { total: number }[])[0]?.total ?? 0
    : 0;

  const totalAmount = result.total_lesson_amount + result.total_transit_amount + adjustments;
  let runId: number;

  if (existing) {
    runId = existing.id as number;
    await execute(
      `UPDATE payroll_runs SET total_lesson_amount = ?, total_transit_amount = ?, total_adjustment_amount = ?, total_amount = ?, payment_date = ?, generated_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [result.total_lesson_amount, result.total_transit_amount, adjustments, totalAmount, paymentDate, runId]
    );
    await execute(`DELETE FROM payroll_lines WHERE payroll_run_id = ?`, [runId]);
  } else {
    const r = await execute(
      `INSERT INTO payroll_runs (year_month, instructor_id, total_lesson_amount, total_transit_amount, total_adjustment_amount, total_amount, payment_date, status, generated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'draft', CURRENT_TIMESTAMP)`,
      [yearMonth, result.instructor_id, result.total_lesson_amount, result.total_transit_amount, totalAmount, paymentDate]
    );
    runId = Number(r.lastInsertRowid);
  }

  for (const line of result.lines) {
    await execute(
      `INSERT INTO payroll_lines (payroll_run_id, lesson_date, class_name, duration_minutes, studio_name, studio_id, lesson_master_id, lesson_rate, transit_fee, source, source_ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, line.lesson_date, line.class_name, line.duration_minutes, line.studio_name, line.studio_id, line.lesson_master_id, line.lesson_rate, line.transit_fee, line.source, line.source_ref_id]
    );
  }

  return runId;
}

/**
 * 当月の draft 給与runのうち、今回の計算結果に含まれない(=実績が消えた/全休講)講師の
 * run を 0円化する。前回計算の draft 金額が残置され「全員確定→振込CSV」で誤支給に
 * なるのを防ぐ(A-2)。confirmed/paid は一切触らない。調整(adjustments)は保持する。
 * @param keepInstructorIds 今回 run を作成/更新した講師ID
 * @returns 0円化した run 数
 */
export async function zeroStaleDraftPayrollRuns(yearMonth: string, keepInstructorIds: number[]): Promise<number> {
  const keep = new Set(keepInstructorIds);
  const drafts = (await getAll(
    `SELECT id, instructor_id FROM payroll_runs WHERE year_month = ? AND status = 'draft'`,
    [yearMonth]
  )) as { id: number; instructor_id: number }[];
  let cleaned = 0;
  for (const d of drafts) {
    if (keep.has(d.instructor_id)) continue;
    const adj = ((await getAll(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM payroll_adjustments WHERE payroll_run_id = ?`,
      [d.id]
    )) as { total: number }[])[0]?.total ?? 0;
    await execute(
      `UPDATE payroll_runs SET total_lesson_amount = 0, total_transit_amount = 0,
              total_adjustment_amount = ?, total_amount = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [adj, adj, d.id]
    );
    await execute(`DELETE FROM payroll_lines WHERE payroll_run_id = ?`, [d.id]);
    cleaned++;
  }
  return cleaned;
}
