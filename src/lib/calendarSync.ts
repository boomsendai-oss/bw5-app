// Googleカレンダーの実績を lesson_instances へ反映する同期本体。
// 画面(/api/staff/calendar-actuals/sync)と自動実行(/api/cron/monthly-close)の
// 両方から呼ぶため、routeではなくここに置く。
// 設計: docs/superpowers/specs/2026-08-28-monthly-close-automation-design.md

import { getAll, getOne, batch } from './db';
import { fetchEventsForRange } from './lessonCalendar';
import { expandMasterSlots } from './lessonResolver';
import {
  resolveCalendarEvent, STUDIO_ALIAS_SEED, UNREGISTERED_VENUES,
  type NamedRef, type ResolvedLesson,
} from './calendarActuals';
import { reconcileDay, type MasterSlotLite, type InstanceWrite } from './calendarReconcile';

export type ReviewItem = { date: string; start: string; class_name: string; issues: string[] };

export type SyncResult = {
  year_month: string;
  range: string | null;
  applied: boolean;
  skippedReason?: string;   // 月確定済み・対象日なし など(エラーではない)
  held: number;
  notHeld: number;
  extra: number;
  needsReview: ReviewItem[];
  untouchedSlots: number;
  unregisteredVenues: string[];
  written: number;
};

/**
 * 1ヶ月ぶんを同期する。**apply=false なら1行も書かない**。
 *
 * 安全側の制約:
 *   - **過去日のみ**。未来日の instance は HACOMONO の予約枠生成につながるため触らない
 *   - 月確定済み(month_confirmations)の月は書き換えない
 *   - 読めなかった予定と、それに時間が重なる枠は書き込まない(判断を人に残す)
 */
export async function syncCalendarActuals(
  ym: string,
  opts: { apply: boolean }
): Promise<SyncResult> {
  const base: SyncResult = {
    year_month: ym, range: null, applied: false, held: 0, notHeld: 0, extra: 0,
    needsReview: [], untouchedSlots: 0, unregisteredVenues: [], written: 0,
  };

  if (await getOne('SELECT year_month FROM month_confirmations WHERE year_month = ?', [ym])) {
    return { ...base, skippedReason: '月確定済みのため書き換えない' };
  }

  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
  const limit = todayJst < monthEnd ? todayJst : monthEnd;
  if (limit < `${ym}-01`) return { ...base, skippedReason: 'まだ対象日がない' };

  const instructors = (await getAll('SELECT id, name FROM instructors ORDER BY id')) as unknown as NamedRef[];
  const studioRows = (await getAll('SELECT id, name FROM studios ORDER BY id')) as unknown as { id: number; name: string }[];
  const studios: NamedRef[] = studioRows.map((s) => ({
    id: s.id, name: s.name, aliases: STUDIO_ALIAS_SEED[s.name] ?? [],
  }));
  // まだ studios に無い会場は負のidで置き、「金額が付かない」を件数として可視化する
  UNREGISTERED_VENUES.forEach((v, i) => {
    if (!studioRows.some((s) => s.name === v.name)) studios.push({ id: -(i + 1), name: v.name, aliases: v.aliases });
  });

  type MasterRow = {
    id: number; class_name: string; default_day_of_week: number;
    default_start_time: string | null; default_end_time: string | null;
    default_instructor_id: number | null; default_studio_id: number | null;
    start_date: string | null; end_date: string | null;
  };
  const masters = (await getAll(
    `SELECT id, class_name, default_day_of_week, default_start_time, default_end_time,
            default_instructor_id, default_studio_id, start_date, end_date
     FROM lesson_master WHERE active = 1`
  )) as unknown as MasterRow[];

  const events = (await fetchEventsForRange(`${ym}-01`, limit)).filter((ev) => ev.date <= limit);
  const resolved = events.map((ev) => resolveCalendarEvent(ev, instructors, studios));
  const byDate = new Map<string, ResolvedLesson[]>();
  for (const r of resolved) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);

  // 既存instanceを無視して**その月の全枠**を出す(既存が間違っている可能性があるため)
  const slotsByDate = new Map<string, MasterSlotLite[]>();
  for (const { master, dateStr } of expandMasterSlots(ym, masters, new Set<string>())) {
    if (dateStr > limit) continue;
    const list = slotsByDate.get(dateStr) ?? slotsByDate.set(dateStr, []).get(dateStr)!;
    list.push({
      master_id: master.id, date: dateStr,
      start_time: master.default_start_time ?? '00:00',
      end_time: master.default_end_time ?? '00:00',
      instructor_id: master.default_instructor_id,
      studio_id: master.default_studio_id,
      class_name: master.class_name,
    });
  }

  const keep: InstanceWrite[] = [], removed: InstanceWrite[] = [], extra: InstanceWrite[] = [];
  const needsReview: ResolvedLesson[] = [];
  let untouched = 0;
  for (const date of new Set([...slotsByDate.keys(), ...byDate.keys()])) {
    const p = reconcileDay(slotsByDate.get(date) ?? [], byDate.get(date) ?? []);
    keep.push(...p.keep); removed.push(...p.removed); extra.push(...p.extra);
    needsReview.push(...p.needsReview); untouched += p.skipped.length;
  }

  // 未登録会場(負のid)は studio_id に入れない。金額が付かないので NULL で可視化する。
  const clean = (w: InstanceWrite) => ({ ...w, studio_id: (w.studio_id ?? 0) > 0 ? w.studio_id : null });

  const result: SyncResult = {
    ...base,
    range: `${ym}-01 〜 ${limit}`,
    applied: opts.apply,
    held: keep.length,
    notHeld: removed.length,
    extra: extra.length,
    needsReview: needsReview.map((r) => ({ date: r.date, start: r.start, class_name: r.class_name, issues: r.issues })),
    untouchedSlots: untouched,
    unregisteredVenues: [...new Set(
      [...keep, ...extra].filter((w) => (w.studio_id ?? 0) < 0).map((w) => w.studio_id!).map(
        (id) => studios.find((s) => s.id === id)?.name ?? '?'
      )
    )],
  };
  if (!opts.apply) return result;

  // 1件ずつ execute すると80件超で maxDuration を超える。batch は1トランザクション。
  // idx_li_master_date は部分索引なので ON CONFLICT にも同じ WHERE が要る。
  const UPSERT = `INSERT INTO lesson_instances
      (master_id, date, start_time, end_time, studio_id, instructor_id, status, notes, auto_materialized)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(master_id, date) WHERE master_id IS NOT NULL DO UPDATE SET
       start_time=excluded.start_time, end_time=excluded.end_time,
       studio_id=excluded.studio_id, instructor_id=excluded.instructor_id,
       status=excluded.status, notes=excluded.notes, updated_at=CURRENT_TIMESTAMP`;

  const stmts = [...keep, ...removed].map(clean).map((w) => ({
    sql: UPSERT,
    args: [w.master_id, w.date, w.start_time, w.end_time, w.studio_id, w.instructor_id, w.status, w.note],
  }));

  const existing = (await getAll(
    `SELECT date, start_time, COALESCE(instructor_id, -1) AS iid FROM lesson_instances
     WHERE master_id IS NULL AND date BETWEEN ? AND ?`,
    [`${ym}-01`, limit]
  )) as unknown as { date: string; start_time: string; iid: number }[];
  const seen = new Set(existing.map((e) => `${e.date}_${e.start_time}_${e.iid}`));
  for (const w of extra.map(clean)) {
    const k = `${w.date}_${w.start_time}_${w.instructor_id ?? -1}`;
    if (seen.has(k)) continue;
    seen.add(k);
    stmts.push({
      sql: `INSERT INTO lesson_instances
              (master_id, date, start_time, end_time, studio_id, instructor_id, status, notes, auto_materialized)
            VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 1)`,
      args: [w.date, w.start_time, w.end_time, w.studio_id, w.instructor_id, w.status, w.note],
    });
  }

  if (stmts.length > 0) await batch(stmts);
  return { ...result, written: stmts.length };
}
