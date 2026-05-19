import { execute, getAll, getOne } from './db';

export type PayrollLine = {
  lesson_date: string;
  class_name: string | null;
  duration_minutes: number | null;
  studio_name: string | null;
  lesson_rate: number;
  transit_fee: number;
  source: 'lesson_instance' | 'lesson_master_expanded';
  source_ref_id: number | null;
};

export type PayrollResult = {
  instructor_id: number;
  instructor_name: string;
  salary_type: 'per_lesson' | 'monthly_fixed';
  lines: PayrollLine[];
  total_lesson_amount: number;
  total_transit_amount: number;
};

// 振込予定日: 翌月15日。15日が土日なら翌営業日
function calcPaymentDate(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const next = new Date(y, m, 15);
  while (next.getDay() === 0 || next.getDay() === 6) {
    next.setDate(next.getDate() + 1);
  }
  const yy = next.getFullYear();
  const mm = String(next.getMonth() + 1).padStart(2, '0');
  const dd = String(next.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 月内のレッスン実績(休講除く)を集計してインストラクター別給与を計算
export async function calculatePayrollForMonth(yearMonth: string): Promise<{ payment_date: string; results: PayrollResult[] }> {
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
  const instances = (await getAll(
    `SELECT li.*, lm.class_name, s.name AS studio_name, lm.duration_minutes
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     LEFT JOIN studios s ON s.id = li.studio_id
     WHERE li.date BETWEEN ? AND ? AND li.status != 'cancelled'`,
    [monthStart, monthEnd]
  )) as InstanceRow[];

  type MasterRow = {
    id: number; class_name: string;
    default_day_of_week: number; default_start_time: string; default_end_time: string;
    duration_minutes: number | null; override_rate: number | null;
    default_instructor_id: number | null; default_studio_id: number | null;
    studio_name: string | null;
  };
  const masters = (await getAll(
    `SELECT lm.id, lm.class_name, lm.default_day_of_week, lm.default_start_time, lm.default_end_time,
            lm.duration_minutes, lm.override_rate, lm.default_instructor_id, lm.default_studio_id,
            s.name AS studio_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     WHERE lm.active = 1`
  )) as MasterRow[];

  const resultsMap = new Map<number, PayrollResult>();
  for (const ins of instructors) {
    resultsMap.set(ins.id, {
      instructor_id: ins.id,
      instructor_name: ins.name,
      salary_type: (ins.salary_type as 'per_lesson' | 'monthly_fixed') ?? 'per_lesson',
      lines: [],
      total_lesson_amount: 0,
      total_transit_amount: 0,
    });
  }

  // 1) lesson_instances から確定分を計上
  const expandedKeys = new Set<string>();
  for (const ins of instances) {
    if (!ins.instructor_id) continue;
    expandedKeys.add(`${ins.master_id ?? ''}_${ins.date}`);
    const result = resultsMap.get(ins.instructor_id);
    if (!result) continue;
    if (result.salary_type === 'monthly_fixed') continue;
    const dm = ins.duration_minutes ?? minutesBetween(ins.start_time, ins.end_time);
    const rate = rateMap.get(`${ins.instructor_id}_${dm}`) ?? 0;
    const transit = ins.transit_fee_override ?? (ins.studio_id ? (transitMap.get(`${ins.instructor_id}_${ins.studio_id}`) ?? 0) : 0);
    result.lines.push({
      lesson_date: ins.date,
      class_name: ins.class_name,
      duration_minutes: dm,
      studio_name: ins.studio_name,
      lesson_rate: rate,
      transit_fee: transit,
      source: 'lesson_instance',
      source_ref_id: ins.id,
    });
    result.total_lesson_amount += rate;
    result.total_transit_amount += transit;
  }

  // 2) lesson_master 週次展開 (instances にない日を埋める)
  for (let d = 1; d <= lastDay; d++) {
    const dateObj = new Date(y, m - 1, d);
    const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const dow = dateObj.getDay();
    for (const master of masters) {
      if (master.default_day_of_week !== dow) continue;
      if (!master.default_instructor_id) continue;
      if (expandedKeys.has(`${master.id}_${dateStr}`)) continue;
      const result = resultsMap.get(master.default_instructor_id);
      if (!result) continue;
      if (result.salary_type === 'monthly_fixed') continue;
      const dm = master.duration_minutes ?? (master.default_start_time && master.default_end_time ? minutesBetween(master.default_start_time, master.default_end_time) : 0);
      const rate = master.override_rate ?? rateMap.get(`${master.default_instructor_id}_${dm}`) ?? 0;
      const transit = master.default_studio_id ? (transitMap.get(`${master.default_instructor_id}_${master.default_studio_id}`) ?? 0) : 0;
      result.lines.push({
        lesson_date: dateStr,
        class_name: master.class_name,
        duration_minutes: dm,
        studio_name: master.studio_name,
        lesson_rate: rate,
        transit_fee: transit,
        source: 'lesson_master_expanded',
        source_ref_id: master.id,
      });
      result.total_lesson_amount += rate;
      result.total_transit_amount += transit;
    }
  }

  // 3) monthly_fixed の人は固定額をlesson_amountに
  for (const ins of instructors) {
    if (ins.salary_type === 'monthly_fixed') {
      const result = resultsMap.get(ins.id);
      if (!result) continue;
      result.total_lesson_amount = ins.monthly_fixed_amount ?? 0;
    }
  }

  // 日付順ソート
  for (const r of resultsMap.values()) {
    r.lines.sort((a, b) => a.lesson_date.localeCompare(b.lesson_date));
  }

  return {
    payment_date: calcPaymentDate(yearMonth),
    results: Array.from(resultsMap.values()),
  };
}

function minutesBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
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
      `INSERT INTO payroll_lines (payroll_run_id, lesson_date, class_name, duration_minutes, studio_name, lesson_rate, transit_fee, source, source_ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, line.lesson_date, line.class_name, line.duration_minutes, line.studio_name, line.lesson_rate, line.transit_fee, line.source, line.source_ref_id]
    );
  }

  return runId;
}
