import { execute, getAll, getOne } from './db';
import { isMasterOutOfRange } from './lessonResolver';

// ============================================
// 月の確定/凍結 (Phase2 ①)
// ============================================
//
// 「確定」= ある月のレッスン予定をスナップショット化(materialize)し、
//   lesson_master の変更がその月へ遡及反映されないように凍結する仕組み。
//
// 流れ:
//   1. confirmMonth(): その月の master 週次展開で表示される分を lesson_instances として実体化
//      (既に instance がある (master_id, date) は触らない = 手動編集/休講/削除/移動を保全)
//      → month_confirmations に行を記録。
//   2. 各展開サイト (calendar route / payroll / studioBilling / scheduleExport) は
//      isMonthConfirmed() が true の月では master 週次展開をスキップし、instance のみを使う。
//   3. unconfirmMonth(): 行を消すと master 展開が再開する (= master と再同期)。
//
// 重要: 「確定」は master 変更の遡及反映を止めるだけ。
//   手動編集 (編集/休講/削除/移動/全休/追加) は確定後も常に可能
//   (= イントラ指摘で明細を直して再アップロードできる)。

/** 'YYYY-MM' が確定済みか */
export async function isMonthConfirmed(yearMonth: string): Promise<boolean> {
  const row = await getOne(`SELECT year_month FROM month_confirmations WHERE year_month = ?`, [yearMonth]);
  return !!row;
}

/** 確定済み月の集合 (scheduleExport のような複数月またぎ用) */
export async function getConfirmedMonthsSet(): Promise<Set<string>> {
  const rows = (await getAll(`SELECT year_month FROM month_confirmations`)) as { year_month: string }[];
  return new Set(rows.map(r => r.year_month));
}

/** 確定情報 (UI 表示用) */
export async function getMonthConfirmation(yearMonth: string): Promise<{ year_month: string; confirmed_at: string; materialized_count: number; note: string | null } | null> {
  return (await getOne(
    `SELECT year_month, confirmed_at, materialized_count, note FROM month_confirmations WHERE year_month = ?`,
    [yearMonth]
  )) as { year_month: string; confirmed_at: string; materialized_count: number; note: string | null } | null;
}

type MasterRow = {
  id: number;
  default_day_of_week: number | null;
  default_start_time: string | null;
  default_end_time: string | null;
  default_studio_id: number | null;
  default_instructor_id: number | null;
  start_date: string | null;
  end_date: string | null;
};

/**
 * その月の master 週次展開で「まだ instance になっていない」分を lesson_instances として実体化する。
 * 既に instance がある (master_id, date) は一切触らない (status=removed/cancelled も含めて尊重)。
 * @returns 作成した instance 件数
 */
export async function materializeMonth(yearMonth: string): Promise<number> {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`invalid yearMonth: ${yearMonth}`);
  }
  const daysInMonth = new Date(y, m, 0).getDate();
  const startStr = `${yearMonth}-01`;
  const endStr = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`;

  // 既存 instance の (master_id, date) を収集 (status 不問 → removed/cancelled も上書き再生成しない)
  const existingInstances = (await getAll(
    `SELECT master_id, date FROM lesson_instances WHERE date BETWEEN ? AND ?`,
    [startStr, endStr]
  )) as { master_id: number | null; date: string }[];
  const existing = new Set<string>();
  for (const ins of existingInstances) {
    if (ins.master_id != null) existing.add(`${ins.master_id}_${ins.date.slice(0, 10)}`);
  }

  const masters = (await getAll(
    `SELECT id, default_day_of_week, default_start_time, default_end_time, default_studio_id, default_instructor_id,
            start_date, end_date
     FROM lesson_master WHERE active = 1`
  )) as MasterRow[];

  let created = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${yearMonth}-${String(d).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, d).getDay();
    for (const mst of masters) {
      if (mst.default_day_of_week !== dow) continue;
      if (!mst.default_start_time || !mst.default_end_time) continue; // 時間未設定マスターは展開対象外
      if (isMasterOutOfRange(mst, dateStr)) continue; // 開講期間外(終了クラス等)は実体化しない
      if (existing.has(`${mst.id}_${dateStr}`)) continue;
      await execute(
        `INSERT INTO lesson_instances (master_id, date, start_time, end_time, studio_id, instructor_id, status, auto_materialized)
         VALUES (?, ?, ?, ?, ?, ?, 'scheduled', 1)`,
        [mst.id, dateStr, mst.default_start_time, mst.default_end_time, mst.default_studio_id, mst.default_instructor_id]
      );
      // 連続実体化を防ぐため、このループ内でも既存扱いにする
      existing.add(`${mst.id}_${dateStr}`);
      created++;
    }
  }
  return created;
}

/** 月を確定 (materialize + 記録)。既に確定済みなら materialize はせず件数0で冪等に返す。 */
export async function confirmMonth(yearMonth: string, note?: string): Promise<{ created: number; alreadyConfirmed: boolean }> {
  if (await isMonthConfirmed(yearMonth)) {
    return { created: 0, alreadyConfirmed: true };
  }
  const created = await materializeMonth(yearMonth);
  await execute(
    `INSERT INTO month_confirmations (year_month, materialized_count, note) VALUES (?, ?, ?)`,
    [yearMonth, created, note ?? null]
  );
  return { created, alreadyConfirmed: false };
}

/**
 * 月の確定を解除 (= master と再同期)。
 * 確定時に自動実体化した未編集の instance (auto_materialized=1) のみ削除し、
 * 確定前の状態に戻す → master 週次展開が再開する。
 * 手動で作成/編集/休講した instance (auto_materialized=0) は決定として残す。
 */
export async function unconfirmMonth(yearMonth: string): Promise<void> {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`invalid yearMonth: ${yearMonth}`);
  }
  const daysInMonth = new Date(y, m, 0).getDate();
  const startStr = `${yearMonth}-01`;
  const endStr = `${yearMonth}-${String(daysInMonth).padStart(2, '0')}`;
  await execute(
    `DELETE FROM lesson_instances WHERE date BETWEEN ? AND ? AND auto_materialized = 1`,
    [startStr, endStr]
  );
  await execute(`DELETE FROM month_confirmations WHERE year_month = ?`, [yearMonth]);
}
