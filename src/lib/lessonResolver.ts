// レッスン展開ロジックの共通モジュール
// payroll-calc.ts / studioBilling.ts / scheduleExport.ts が共有する
// 「lesson_master 週次展開 + lesson_instances 重複除外」アルゴリズムを集約。

/**
 * "HH:MM" or "HH:MM:SS" → 分数。不正なら 0。
 */
export function minutesBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * instance 一覧から expandedKeys を構築する。
 * cancelled/removed も含めて master_id + date を記録し、
 * 後段の master 週次展開での重複を防ぐ。
 */
export function buildExpandedKeys(
  instances: readonly { master_id: number | null; date: string }[],
): Set<string> {
  const keys = new Set<string>();
  for (const ins of instances) {
    if (ins.master_id != null) keys.add(`${ins.master_id}_${ins.date}`);
  }
  return keys;
}

/**
 * instance が出力対象外 (cancelled / removed) かどうか。
 */
export function isInactiveStatus(status: string): boolean {
  return status === 'cancelled' || status === 'removed';
}

/**
 * master の start_date / end_date に基づいて、指定日が範囲外かどうかを判定。
 * 範囲外なら true (= 生成しない)。
 */
export function isMasterOutOfRange(
  master: { start_date?: string | null; end_date?: string | null },
  dateStr: string,
): boolean {
  if (master.start_date && dateStr < master.start_date) return true;
  if (master.end_date && dateStr > master.end_date) return true;
  return false;
}

type MasterSlot<M> = { master: M; dateStr: string; dow: number };

/**
 * 単月: expandedKeys にない master × 日付 の組み合わせを列挙する。
 * 消費側はこのリストをイテレートしてドメイン固有のレコードを生成する。
 */
export function expandMasterSlots<M extends { id: number; default_day_of_week: number }>(
  yearMonth: string,
  masters: readonly M[],
  expandedKeys: Set<string>,
): MasterSlot<M>[] {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const slots: MasterSlot<M>[] = [];
  for (let d = 1; d <= lastDay; d++) {
    const dateObj = new Date(y, m - 1, d);
    const dow = dateObj.getDay();
    const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
    for (const master of masters) {
      if (master.default_day_of_week !== dow) continue;
      if (expandedKeys.has(`${master.id}_${dateStr}`)) continue;
      slots.push({ master, dateStr, dow });
    }
  }
  return slots;
}

/**
 * 複数月（日付レンジ指定）版の master 展開。
 * confirmedMonths に含まれる月は展開をスキップする（確定済み月は instance のみ）。
 */
export function expandMasterSlotsRange<
  M extends { id: number; default_day_of_week: number },
>(
  startDate: string,
  endDate: string,
  masters: readonly M[],
  expandedKeys: Set<string>,
  confirmedMonths?: Set<string>,
): MasterSlot<M>[] {
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const last = new Date(ey, em - 1, ed);
  const slots: MasterSlot<M>[] = [];
  while (cursor <= last) {
    const y = cursor.getFullYear();
    const m = cursor.getMonth() + 1;
    const d = cursor.getDate();
    const dow = cursor.getDay();
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const ym = dateStr.slice(0, 7);
    if (!confirmedMonths?.has(ym)) {
      for (const master of masters) {
        if (master.default_day_of_week !== dow) continue;
        if (expandedKeys.has(`${master.id}_${dateStr}`)) continue;
        slots.push({ master, dateStr, dow });
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}
