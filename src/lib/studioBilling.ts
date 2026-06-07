import { execute, getAll, getOne } from './db';
import { isMonthConfirmed } from './monthConfirm';

export type BillingLine = {
  lesson_date: string;
  class_name: string | null;
  lesson_master_id: number | null;
  hours: number;
  hourly_rate: number;
  amount: number;
  source: 'lesson_instance' | 'lesson_master_expanded' | 'block_rental' | 'daily_buffer';
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

function toMinutes(t: string): number {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

type Block = { label: string; start: string; end: string; price: number };

// [minStart, maxEnd] をカバーできる最小の区分を選ぶ。
// 候補(start<=minStart かつ end>=maxEnd)のうち price最小。なければ全日(=最も広く price最大の区分)を返す。
function selectBlock(blocks: Block[], minStart: string, maxEnd: string): Block | null {
  if (blocks.length === 0) return null;
  const ms = toMinutes(minStart);
  const me = toMinutes(maxEnd);
  const covering = blocks.filter(b => toMinutes(b.start) <= ms && toMinutes(b.end) >= me);
  if (covering.length > 0) {
    return covering.reduce((best, b) => (b.price < best.price ? b : best));
  }
  // カバーできる区分がない場合は全日相当(終了が最も遅く、開始が最も早い=最大価格)をフォールバック
  return blocks.reduce((best, b) => (b.price > best.price ? b : best));
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
  // 休講(cancelled)も含めて全インスタンスを取得する。
  // - 開催分は使用料に計上
  // - 休講分は計上しないが、master+日付を expandedKeys に登録して
  //   master 週次展開での再計上(=休講なのに使用料に乗る)を防ぐ
  const instances = (await getAll(
    `SELECT li.id, li.date, li.start_time, li.end_time, li.studio_id, li.master_id, lm.class_name, li.status
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     WHERE li.date BETWEEN ? AND ?`,
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

  // 区分制(block)スタジオ用: studio_id → date → その日のレッスン時間帯リスト
  type BlockLesson = { start: string; end: string };
  const blockLessons = new Map<number, Map<string, BlockLesson[]>>();
  function recordBlockLesson(studioId: number, date: string, start: string, end: string) {
    if (!start || !end) return;
    let byDate = blockLessons.get(studioId);
    if (!byDate) { byDate = new Map(); blockLessons.set(studioId, byDate); }
    const arr = byDate.get(date) ?? [];
    arr.push({ start, end });
    byDate.set(date, arr);
  }

  // 1) lesson_instances 集計
  const expandedKeys = new Set<string>();
  // 時間貸しスタジオで「その日にレッスンがある (スタジオ,日付)」を記録。
  // 日次バッファ(daily_buffer_minutes)は後段でこのキーごとに1回だけ加算する。
  const hourlyDayKeys = new Set<string>();
  for (const ins of instances) {
    // master+日付を記録し、後段の master 週次展開での重複/再計上を防ぐ
    // (休講/削除インスタンスも記録する → その日の master 再展開を抑止)
    if (ins.master_id != null) expandedKeys.add(`${ins.master_id}_${ins.date}`);
    // 休講(cancelled)・削除(removed)は使用料に計上しない
    if (ins.status === 'cancelled' || ins.status === 'removed') continue;
    if (!ins.studio_id) continue;
    const result = resultsMap.get(ins.studio_id);
    const studio = studioMap.get(ins.studio_id);
    if (!result || !studio) continue;
    // 区分制スタジオは時間貸し計上をスキップし、日付ごとに時間帯を収集して後段で区分料金を計上する
    if (studio.pricing_model === 'block') {
      recordBlockLesson(studio.id, ins.date, ins.start_time, ins.end_time);
      continue;
    }
    if (studio.pricing_model === 'hourly') hourlyDayKeys.add(`${studio.id}_${ins.date}`);
    // バッファは加算しない (後段で日次に1回だけ加算)
    const dm = minutesBetween(ins.start_time, ins.end_time);
    const hours = dm / 60;
    const amount = studio.pricing_model === 'hourly' ? Math.ceil(hours * studio.hourly_rate) : 0;
    result.lines.push({
      lesson_date: ins.date,
      class_name: ins.class_name,
      lesson_master_id: ins.master_id ?? null,
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
  // 確定(凍結)済み月では master 展開しない (確定時に materialize 済み instance のみで計算)。
  const confirmed = await isMonthConfirmed(yearMonth);
  for (let d = 1; !confirmed && d <= lastDay; d++) {
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
      // 区分制スタジオは時間貸し計上をスキップし、日付ごとに時間帯を収集して後段で区分料金を計上する
      if (studio.pricing_model === 'block') {
        const end = master.default_end_time
          || (master.default_start_time && master.duration_minutes
            ? formatTime(toMinutes(master.default_start_time) + master.duration_minutes)
            : '');
        recordBlockLesson(studio.id, dateStr, master.default_start_time, end);
        continue;
      }
      if (studio.pricing_model === 'hourly') hourlyDayKeys.add(`${studio.id}_${dateStr}`);
      // バッファは加算しない (後段で日次に1回だけ加算)
      const dm = (master.duration_minutes ?? (master.default_start_time && master.default_end_time ? minutesBetween(master.default_start_time, master.default_end_time) : 0));
      const hours = dm / 60;
      const amount = studio.pricing_model === 'hourly' ? Math.ceil(hours * studio.hourly_rate) : 0;
      result.lines.push({
        lesson_date: dateStr,
        class_name: master.class_name,
        lesson_master_id: master.id,
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

  // 2.5) 日次バッファを (スタジオ,日付) ごとに1回だけ加算する。
  //   従来は各レッスンに daily_buffer を足していたため、1日に複数レッスンがある日は
  //   バッファが二重(以上)に計上されていた (例: 多賀城 入門+初級 で +60分)。
  //   daily_buffer_minutes は本来「その日のレンタル1回分の準備/休憩/退出オーバーヘッド」
  //   なので、1日1回だけ加算するのが正しい。
  for (const key of hourlyDayKeys) {
    const sep = key.indexOf('_');
    const sid = Number(key.slice(0, sep));
    const dateStr = key.slice(sep + 1);
    const studio = studioMap.get(sid);
    const result = resultsMap.get(sid);
    if (!studio || !result || studio.pricing_model !== 'hourly') continue;
    const buf = studio.daily_buffer_minutes ?? 0;
    if (buf <= 0) continue;
    const hours = buf / 60;
    const amount = Math.ceil(hours * studio.hourly_rate);
    result.lines.push({
      lesson_date: dateStr,
      class_name: `（準備・バッファ ${buf}分）`,
      lesson_master_id: null,
      hours,
      hourly_rate: studio.hourly_rate,
      amount,
      source: 'daily_buffer',
      source_ref_id: null,
    });
    result.total_hours += hours;
    result.total_lesson_amount += amount;
  }

  // 3) block_pricing スタジオ (七ヶ浜国際村等) → 区分単位で計上
  // 1日単位の区分レンタル。その日のレッスン群の最早開始〜最遅終了をカバーする最小区分の料金を、その日に1回だけ計上する。
  // ※ block_pricing JSON仕様: [{"label":"夜間","start":"17:00","end":"22:00","price":1100}, ...]
  for (const studio of studios) {
    if (studio.pricing_model !== 'block') continue;
    const result = resultsMap.get(studio.id);
    if (!result) continue;
    const byDate = blockLessons.get(studio.id);
    if (!byDate) continue; // 当月利用なし → 料金0
    let blocks: Block[] = [];
    if (studio.block_pricing) {
      try {
        const parsed = JSON.parse(studio.block_pricing);
        if (Array.isArray(parsed)) blocks = parsed as Block[];
      } catch {
        blocks = []; // パース失敗時はフォールバック(料金0)
      }
    }
    const dates = Array.from(byDate.keys()).sort((a, b) => a.localeCompare(b));
    for (const dateStr of dates) {
      const lessons = byDate.get(dateStr) ?? [];
      if (lessons.length === 0) continue;
      let minStart = lessons[0].start;
      let maxEnd = lessons[0].end;
      for (const l of lessons) {
        if (toMinutes(l.start) < toMinutes(minStart)) minStart = l.start;
        if (toMinutes(l.end) > toMinutes(maxEnd)) maxEnd = l.end;
      }
      const block = selectBlock(blocks, minStart, maxEnd);
      // レッスン実時間合計(分) を hours として記録
      const totalLessonMinutes = lessons.reduce((sum, l) => sum + minutesBetween(l.start, l.end), 0);
      const hours = totalLessonMinutes / 60;
      const price = block?.price ?? 0;
      result.lines.push({
        lesson_date: dateStr,
        class_name: block ? `[${block.label}]` : '[区分未設定]',
        lesson_master_id: null,
        hours,
        hourly_rate: 0,
        amount: price,
        source: 'block_rental',
        source_ref_id: null,
      });
      result.total_hours += hours;
      result.total_lesson_amount += price;
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
      `INSERT INTO studio_billing_lines (studio_billing_run_id, lesson_date, class_name, lesson_master_id, hours, hourly_rate, amount, source, source_ref_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [runId, line.lesson_date, line.class_name, line.lesson_master_id, line.hours, line.hourly_rate, line.amount, line.source, line.source_ref_id]
    );
  }

  return runId;
}
