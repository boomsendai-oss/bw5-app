import { execute, getAll, getOne } from './db';

export type BillingLine = {
  lesson_date: string;
  class_name: string | null;
  hours: number;
  hourly_rate: number;
  amount: number;
  source: 'lesson_instance' | 'lesson_master_expanded' | 'block_rental';
  source_ref_id: number | null;
};

export type StudioBillingResult = {
  studio_id: number;
  studio_name: string;
  pricing_model: string;  // hourly | block
  payment_type: string;
  lines: BillingLine[];
  total_hours: number;
  total_lesson_amount: number;
};

function minutesBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function calcPaymentDate(yearMonth: string, paymentType: string): string {
  // prepaid: 当月分を前月末日 / postpaid: 当月分を翌月15日
  const [y, m] = yearMonth.split('-').map(Number);
  if (paymentType === 'prepaid_bank') {
    const d = new Date(y, m - 1, 0); // 前月末
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return formatDate(d);
  }
  // postpaid or cash
  const d = new Date(y, m, 15);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return formatDate(d);
}
function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 月内のレッスン実績(休講除く)から各スタジオの使用料を計算
export async function calculateStudioBillingForMonth(yearMonth: string): Promise<{ results: StudioBillingResult[]; payment_dates: Record<number, string> }> {
  const [y, m] = yearMonth.split('-').map(Number);
  const monthStart = `${yearMonth}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const monthEnd = `${yearMonth}-${String(lastDay).padStart(2, '0')}`;

  type StudioRow = {
    id: number; name: string;
    pricing_model: string; hourly_rate: number;
    block_pricing: string | null;
    daily_buffer_minutes: number;
    payment_type: string;
  };
  const studios = (await getAll(`SELECT id, name, pricing_model, hourly_rate, block_pricing, daily_buffer_minutes, payment_type FROM studios WHERE active = 1`)) as StudioRow[];

  type InstanceRow = {
    id: number; date: string; start_time: string; end_time: string;
    studio_id: number | null; master_id: number | null;
    class_name: string | null; status: string;
  };
  const instances = (await getAll(
    `SELECT li.id, li.date, li.start_time, li.end_time, li.studio_id, li.master_id, lm.class_name, li.status
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     WHERE li.date BETWEEN ? AND ? AND li.status != 'cancelled'`,
    [monthStart, monthEnd]
  )) as InstanceRow[];

  type MasterRow = {
    id: number; class_name: string;
    default_day_of_week: number; default_start_time: string; default_end_time: string;
    duration_minutes: number | null;
    default_studio_id: number | null;
  };
  const masters = (await getAll(
    `SELECT id, class_name, default_day_of_week, default_start_time, default_end_time, duration_minutes, default_studio_id
     FROM lesson_master WHERE active = 1`
  )) as MasterRow[];

  const resultsMap = new Map<number, StudioBillingResult>();
  for (const s of studios) {
    resultsMap.set(s.id, {
      studio_id: s.id,
      studio_name: s.name,
      pricing_model: s.pricing_model,
      payment_type: s.payment_type,
      lines: [],
      total_hours: 0,
      total_lesson_amount: 0,
    });
  }
  const studioMap = new Map(studios.map(s => [s.id, s]));

  // 1) lesson_instances 集計
  const expandedKeys = new Set<string>();
  for (const ins of instances) {
    if (!ins.studio_id) continue;
    expandedKeys.add(`${ins.master_id ?? ''}_${ins.date}`);
    const result = resultsMap.get(ins.studio_id);
    const studio = studioMap.get(ins.studio_id);
    if (!result || !studio) continue;
    const dm = minutesBetween(ins.start_time, ins.end_time) + (studio.daily_buffer_minutes ?? 0);
    const hours = dm / 60;
    const amount = studio.pricing_model === 'hourly' ? Math.ceil(hours * studio.hourly_rate) : 0;
    result.lines.push({
      lesson_date: ins.date,
      class_name: ins.class_name,
      hours,
      hourly_rate: studio.hourly_rate,
      amount,
      source: 'lesson_instance',
      source_ref_id: ins.id,
    });
    result.total_hours += hours;
    result.total_lesson_amount += amount;
  }

  // 2) lesson_master 週次展開
  for (let d = 1; d <= lastDay; d++) {
    const dateObj = new Date(y, m - 1, d);
    const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const dow = dateObj.getDay();
    for (const master of masters) {
      if (master.default_day_of_week !== dow) continue;
      if (!master.default_studio_id) continue;
      if (expandedKeys.has(`${master.id}_${dateStr}`)) continue;
      const result = resultsMap.get(master.default_studio_id);
      const studio = studioMap.get(master.default_studio_id);
      if (!result || !studio) continue;
      const dm = (master.duration_minutes ?? (master.default_start_time && master.default_end_time ? minutesBetween(master.default_start_time, master.default_end_time) : 0)) + (studio.daily_buffer_minutes ?? 0);
      const hours = dm / 60;
      const amount = studio.pricing_model === 'hourly' ? Math.ceil(hours * studio.hourly_rate) : 0;
      result.lines.push({
        lesson_date: dateStr,
        class_name: master.class_name,
        hours,
        hourly_rate: studio.hourly_rate,
        amount,
        source: 'lesson_master_expanded',
        source_ref_id: master.id,
      });
      result.total_hours += hours;
      result.total_lesson_amount += amount;
    }
  }

  // 3) block_pricing スタジオ (七ヶ浜国際村等) → ブロック単位で計上 (現状はTAROが手動で調整項目として加算する設計でも可)
  // ※ block_pricing JSON仕様: [{"label":"夜間","start":"17:00","end":"22:00","price":3000}] 想定
  for (const studio of studios) {
    if (studio.pricing_model !== 'block' || !studio.block_pricing) continue;
    try {
      const blocks = JSON.parse(studio.block_pricing) as Array<{ label: string; start: string; end: string; price: number }>;
      const result = resultsMap.get(studio.id);
      if (!result) continue;
      // どの日にこのスタジオが使われたか
      const usedDates = new Set<string>();
      for (const line of result.lines) usedDates.add(line.lesson_date);
      for (const dateStr of usedDates) {
        // 該当日付の全レッスンが入る最小ブロックを推定 (簡易: 最初のブロックを使う)
        const block = blocks[0];
        if (block) {
          result.lines.push({
            lesson_date: dateStr,
            class_name: `[${block.label}区分]`,
            hours: 0,
            hourly_rate: 0,
            amount: block.price,
            source: 'block_rental',
            source_ref_id: null,
          });
          result.total_lesson_amount += block.price;
        }
      }
      // hourlyで計算した分を消す(区分料金で上書きされるべき)
      // ただしレッスン明細は残す(参考表示)
    } catch {
      // パースエラーは無視
    }
  }

  // ソート
  for (const r of resultsMap.values()) r.lines.sort((a, b) => a.lesson_date.localeCompare(b.lesson_date));

  const payment_dates: Record<number, string> = {};
  for (const s of studios) {
    payment_dates[s.id] = calcPaymentDate(yearMonth, s.payment_type);
  }

  return { results: Array.from(resultsMap.values()), payment_dates };
}

export async function persistStudioBillingRun(yearMonth: string, result: StudioBillingResult, paymentDate: string): Promise<number> {
  const existing = await getOne(
    `SELECT id, status FROM studio_billing_runs WHERE year_month = ? AND studio_id = ?`,
    [yearMonth, result.studio_id]
  );
  if (existing && existing.status !== 'draft') return existing.id as number;

  const adjustments = existing
    ? ((await getAll(`SELECT COALESCE(SUM(amount), 0) AS total FROM studio_billing_adjustments WHERE studio_billing_run_id = ?`, [existing.id])) as { total: number }[])[0]?.total ?? 0
    : 0;

  const totalAmount = result.total_lesson_amount + adjustments;
  let runId: number;

  if (existing) {
    runId = existing.id as number;
    await execute(
      `UPDATE studio_billing_runs SET total_hours = ?, total_lesson_amount = ?, total_adjustment_amount = ?, total_amount = ?, payment_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [result.total_hours, result.total_lesson_amount, adjustments, totalAmount, paymentDate, runId]
    );
    await execute(`DELETE FROM studio_billing_lines WHERE studio_billing_run_id = ?`, [runId]);
  } else {
    const r = await execute(
      `INSERT INTO studio_billing_runs (year_month, studio_id, total_hours, total_lesson_amount, total_adjustment_amount, total_amount, payment_date, status)
       VALUES (?, ?, ?, ?, 0, ?, ?, 'draft')`,
      [yearMonth, result.studio_id, result.total_hours, result.total_lesson_amount, totalAmount, paymentDate]
    );
    runId = Number(r.lastInsertRowid);
  }

  for (const line of result.lines) {
    await execute(
      `INSERT INTO studio_billing_lines (studio_billing_run_id, lesson_date, class_name, hours, hourly_rate, amount, source, source_ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, line.lesson_date, line.class_name, line.hours, line.hourly_rate, line.amount, line.source, line.source_ref_id]
    );
  }

  return runId;
}
