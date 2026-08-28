import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { fetchEventsForRange } from '@/lib/lessonCalendar';
import { expandMasterSlots } from '@/lib/lessonResolver';
import {
  resolveCalendarEvent, STUDIO_ALIAS_SEED, UNREGISTERED_VENUES,
  type NamedRef, type ResolvedLesson,
} from '@/lib/calendarActuals';
import { reconcileDay, type MasterSlotLite, type InstanceWrite } from '@/lib/calendarReconcile';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/staff/calendar-actuals/sync { year_month, apply? }
// Googleカレンダー(正本)の実績を lesson_instances へ反映する。**apply を付けない限り書かない**。
//
// 安全側の制約:
//   1. **過去日のみ**。未来日の instance は HACOMONO の予約枠生成につながるので触らない
//   2. 月確定済み(month_confirmations)の月は拒否する
//   3. 読めなかった予定・それと時間が重なる枠は書き込まない(判断を人に残す)
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const ym = body.year_month as string | undefined;
  const apply = body.apply === true;
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month is required (YYYY-MM)' }, { status: 400 });
  }

  const confirmed = await getOne('SELECT year_month FROM month_confirmations WHERE year_month = ?', [ym]);
  if (confirmed) {
    return NextResponse.json({ error: `${ym} は月確定済みのため書き換えない` }, { status: 409 });
  }

  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const todayJst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const monthEnd = `${ym}-${String(lastDay).padStart(2, '0')}`;
  // 過去日のみ = 昨日まで
  const cutoff = todayJst < monthEnd ? todayJst : monthEnd;
  const limit = cutoff < `${ym}-01` ? null : cutoff;
  if (!limit) return NextResponse.json({ error: `${ym} はまだ対象日がない` }, { status: 400 });

  const instructors = (await getAll('SELECT id, name FROM instructors ORDER BY id')) as unknown as NamedRef[];
  const studioRows = (await getAll('SELECT id, name FROM studios ORDER BY id')) as unknown as { id: number; name: string }[];
  const studios: NamedRef[] = studioRows.map((s) => ({ id: s.id, name: s.name, aliases: STUDIO_ALIAS_SEED[s.name] ?? [] }));
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

  let events;
  try {
    events = await fetchEventsForRange(`${ym}-01`, limit);
  } catch (e) {
    return NextResponse.json({ error: `カレンダー取得に失敗: ${e instanceof Error ? e.message : e}` }, { status: 502 });
  }

  const resolved: ResolvedLesson[] = events
    .filter((ev) => ev.date <= limit)
    .map((ev) => resolveCalendarEvent(ev, instructors, studios));
  const byDate = new Map<string, ResolvedLesson[]>();
  for (const r of resolved) (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);

  // 既存instanceを無視して**その月の全枠**を出す(既存が間違っている可能性があるため)
  const allSlots = expandMasterSlots(ym, masters, new Set<string>());
  const slotsByDate = new Map<string, MasterSlotLite[]>();
  for (const { master, dateStr } of allSlots) {
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
  const needsReview: ResolvedLesson[] = [], skipped: MasterSlotLite[] = [];
  for (const date of new Set([...slotsByDate.keys(), ...byDate.keys()])) {
    const p = reconcileDay(slotsByDate.get(date) ?? [], byDate.get(date) ?? []);
    keep.push(...p.keep); removed.push(...p.removed); extra.push(...p.extra);
    needsReview.push(...p.needsReview); skipped.push(...p.skipped);
  }

  // 未登録会場(負のid)は studio_id に入れない。金額が付かないので NULL にして可視化する。
  const clean = (w: InstanceWrite) => ({ ...w, studio_id: (w.studio_id ?? 0) > 0 ? w.studio_id : null });

  const summary = {
    year_month: ym, 対象期間: `${ym}-01 〜 ${limit}`, apply,
    開催として記録: keep.length, 未開催として記録: removed.length, 単発として追加: extra.length,
    要確認_書き込まず: needsReview.length, 枠に触れず: skipped.length,
    未登録会場のため会場なしで記録: [...keep, ...extra].filter((w) => (w.studio_id ?? 0) < 0).length,
  };

  if (!apply) {
    return NextResponse.json({
      ...summary, dry_run: true,
      未開催の明細: removed.map((r) => ({ date: r.date, master_id: r.master_id, note: r.note })),
      単発の明細: extra.map((r) => ({ date: r.date, time: `${r.start_time}-${r.end_time}`, note: r.note })),
      要確認の明細: needsReview.map((r) => ({ date: r.date, start: r.start, class_name: r.class_name, issues: r.issues })),
    });
  }

  // 1件ずつ execute すると80件超で maxDuration=60 を超える(2026-08-28に実測)。
  // batch() でまとめて投げる。1トランザクションなので途中で切れて半端に書かれることもない。
  const UPSERT = `INSERT INTO lesson_instances
      (master_id, date, start_time, end_time, studio_id, instructor_id, status, notes, auto_materialized)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(master_id, date) DO UPDATE SET
       start_time=excluded.start_time, end_time=excluded.end_time,
       studio_id=excluded.studio_id, instructor_id=excluded.instructor_id,
       status=excluded.status, notes=excluded.notes, updated_at=CURRENT_TIMESTAMP`;

  const stmts = [...keep, ...removed].map(clean).map((w) => ({
    sql: UPSERT,
    args: [w.master_id, w.date, w.start_time, w.end_time, w.studio_id, w.instructor_id, w.status, w.note],
  }));

  // 単発は UNIQUE(master_id,date) が効かない(master_id NULL)ので、既存を先に引いて重複を避ける
  const existingExtras = (await getAll(
    `SELECT date, start_time, COALESCE(instructor_id, -1) AS iid FROM lesson_instances
     WHERE master_id IS NULL AND date BETWEEN ? AND ?`,
    [`${ym}-01`, limit]
  )) as unknown as { date: string; start_time: string; iid: number }[];
  const seen = new Set(existingExtras.map((e) => `${e.date}_${e.start_time}_${e.iid}`));
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

  await batch(stmts);
  return NextResponse.json({ ...summary, written: stmts.length });
}
