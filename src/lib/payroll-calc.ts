// 給与計算の純粋関数（DB非依存）
// payroll.ts から抽出。テスト可能にするため分離。

import {
  minutesBetween,
  expandMasterSlots,
} from './lessonResolver';

export type PayrollLine = {
  lesson_date: string;
  class_name: string | null;
  duration_minutes: number | null;
  studio_name: string | null;
  studio_id: number | null;
  lesson_master_id: number | null;
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

/**
 * 振込予定日: 翌月15日。15日が土日なら翌営業日
 */
export function calcPaymentDate(yearMonth: string): string {
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

// minutesBetween is re-exported from lessonResolver for backward compatibility
export { minutesBetween } from './lessonResolver';

/**
 * レッスン単価を決定する。
 * 優先順位: master の override_rate > instructor_rates テーブルの (instructor×分) 単価 > 0
 */
export function resolveRate(
  overrideRate: number | null | undefined,
  rateMap: Map<string, number>,
  instructorId: number,
  durationMinutes: number,
): number {
  return overrideRate ?? rateMap.get(`${instructorId}_${durationMinutes}`) ?? 0;
}

/**
 * 交通費を決定する。
 * - transit_fee_override があればそれを使用
 * - なければ transitMap (instructor×studio) から取得
 * - studio_id がなければ 0
 */
export function resolveTransitFee(
  transitFeeOverride: number | null | undefined,
  transitMap: Map<string, number>,
  instructorId: number,
  studioId: number | null,
): number {
  return transitFeeOverride ?? (studioId ? (transitMap.get(`${instructorId}_${studioId}`) ?? 0) : 0);
}

/**
 * 交通費の重複除外ロジック。
 * 同一 (instructor × studio × date) では1回だけ計上。
 * studioId が null の場合はそのまま計上（重複チェック不可）。
 * @returns [実際に計上する交通費, chargedSetに追加されたか]
 */
export function deduplicateTransit(
  transitCandidate: number,
  instructorId: number,
  studioId: number | null,
  date: string,
  transitCharged: Set<string>,
): number {
  if (transitCandidate <= 0) return 0;
  if (studioId) {
    const tkey = `${instructorId}_${studioId}_${date}`;
    if (transitCharged.has(tkey)) return 0;
    transitCharged.add(tkey);
    return transitCandidate;
  }
  // スタジオ不明の上書きはそのまま計上
  return transitCandidate;
}

// ── instance 集計 (section 1) ──

export type InstanceInput = {
  id: number;
  date: string;
  start_time: string;
  end_time: string;
  instructor_id: number | null;
  studio_id: number | null;
  master_id: number | null;
  status: string;
  class_name: string | null;
  studio_name: string | null;
  duration_minutes: number | null;
  transit_fee_override: number | null;
};

export type InstructorInput = {
  id: number;
  name: string;
  salary_type: string | null;
  monthly_fixed_amount: number | null;
};

export type MasterInput = {
  id: number;
  class_name: string;
  default_day_of_week: number;
  default_start_time: string;
  default_end_time: string;
  duration_minutes: number | null;
  override_rate: number | null;
  default_instructor_id: number | null;
  default_studio_id: number | null;
  studio_name: string | null;
};

/**
 * instance 一覧からレッスン行を集計し、expandedKeys / transitCharged を更新する。
 * PayrollResult の lines / total_lesson_amount / total_transit_amount を更新。
 */
export function aggregateInstances(
  instances: InstanceInput[],
  resultsMap: Map<number, PayrollResult>,
  masterOverrideMap: Map<number, number | null>,
  rateMap: Map<string, number>,
  transitMap: Map<string, number>,
  expandedKeys: Set<string>,
  transitCharged: Set<string>,
): void {
  for (const ins of instances) {
    if (ins.master_id != null) expandedKeys.add(`${ins.master_id}_${ins.date}`);
    if (ins.status === 'cancelled' || ins.status === 'removed') continue;
    if (!ins.instructor_id) continue;
    const result = resultsMap.get(ins.instructor_id);
    if (!result) continue;
    if (result.salary_type === 'monthly_fixed') continue;
    const dm = ins.duration_minutes ?? minutesBetween(ins.start_time, ins.end_time);
    const overrideRate = ins.master_id != null ? (masterOverrideMap.get(ins.master_id) ?? null) : null;
    const rate = resolveRate(overrideRate, rateMap, ins.instructor_id, dm);
    const transitCandidate = resolveTransitFee(ins.transit_fee_override, transitMap, ins.instructor_id, ins.studio_id);
    const transit = deduplicateTransit(transitCandidate, ins.instructor_id, ins.studio_id, ins.date, transitCharged);
    result.lines.push({
      lesson_date: ins.date,
      class_name: ins.class_name,
      duration_minutes: dm,
      studio_name: ins.studio_name,
      studio_id: ins.studio_id ?? null,
      lesson_master_id: ins.master_id ?? null,
      lesson_rate: rate,
      transit_fee: transit,
      source: 'lesson_instance',
      source_ref_id: ins.id,
    });
    result.total_lesson_amount += rate;
    result.total_transit_amount += transit;
  }
}

/**
 * master 週次展開 (instances にない日を埋める)
 */
export function expandMasters(
  yearMonth: string,
  masters: MasterInput[],
  resultsMap: Map<number, PayrollResult>,
  rateMap: Map<string, number>,
  transitMap: Map<string, number>,
  expandedKeys: Set<string>,
  transitCharged: Set<string>,
): void {
  for (const { master, dateStr } of expandMasterSlots(yearMonth, masters, expandedKeys)) {
    if (!master.default_instructor_id) continue;
    const result = resultsMap.get(master.default_instructor_id);
    if (!result) continue;
    if (result.salary_type === 'monthly_fixed') continue;
    const dm = master.duration_minutes ?? (master.default_start_time && master.default_end_time ? minutesBetween(master.default_start_time, master.default_end_time) : 0);
    const rate = resolveRate(master.override_rate, rateMap, master.default_instructor_id, dm);
    const transitCandidate = master.default_studio_id ? (transitMap.get(`${master.default_instructor_id}_${master.default_studio_id}`) ?? 0) : 0;
    const transit = deduplicateTransit(transitCandidate, master.default_instructor_id, master.default_studio_id, dateStr, transitCharged);
    result.lines.push({
      lesson_date: dateStr,
      class_name: master.class_name,
      duration_minutes: dm,
      studio_name: master.studio_name,
      studio_id: master.default_studio_id ?? null,
      lesson_master_id: master.id,
      lesson_rate: rate,
      transit_fee: transit,
      source: 'lesson_master_expanded',
      source_ref_id: master.id,
    });
    result.total_lesson_amount += rate;
    result.total_transit_amount += transit;
  }
}

/**
 * ResultsMap を初期化
 */
export function buildResultsMap(instructors: InstructorInput[]): Map<number, PayrollResult> {
  const map = new Map<number, PayrollResult>();
  for (const ins of instructors) {
    map.set(ins.id, {
      instructor_id: ins.id,
      instructor_name: ins.name,
      salary_type: (ins.salary_type as 'per_lesson' | 'monthly_fixed') ?? 'per_lesson',
      lines: [],
      total_lesson_amount: 0,
      total_transit_amount: 0,
    });
  }
  return map;
}

/**
 * monthly_fixed のインストラクターに固定額を設定
 */
export function applyMonthlyFixed(instructors: InstructorInput[], resultsMap: Map<number, PayrollResult>): void {
  for (const ins of instructors) {
    if (ins.salary_type === 'monthly_fixed') {
      const result = resultsMap.get(ins.id);
      if (!result) continue;
      result.total_lesson_amount = ins.monthly_fixed_amount ?? 0;
    }
  }
}

/**
 * 行を日付順ソート
 */
export function sortLinesByDate(resultsMap: Map<number, PayrollResult>): void {
  for (const r of resultsMap.values()) {
    r.lines.sort((a, b) => a.lesson_date.localeCompare(b.lesson_date));
  }
}
