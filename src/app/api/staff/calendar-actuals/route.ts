import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { fetchEventsForRange } from '@/lib/lessonCalendar';
import {
  resolveCalendarEvent, STUDIO_ALIAS_SEED, UNREGISTERED_VENUES,
  type NamedRef, type ResolvedLesson,
} from '@/lib/calendarActuals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/staff/calendar-actuals?year_month=YYYY-MM
// **読み取り専用**。Googleカレンダー(正本)の実績を解釈して返すだけで、DBには一切書かない。
// 設計 Phase 1 の検証用: 現行ロジック(lesson_master展開)が出す数字との差を安全に見比べる。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const ym = req.nextUrl.searchParams.get('year_month') ?? '';
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: 'year_month is required (YYYY-MM)' }, { status: 400 });
  }
  const [y, m] = ym.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();

  const instructors = (await getAll(
    'SELECT id, name FROM instructors ORDER BY id'
  )) as unknown as NamedRef[];
  const studioRows = (await getAll(
    'SELECT id, name FROM studios ORDER BY id'
  )) as unknown as { id: number; name: string }[];

  // 実在するstudioに別名シードを載せ、未登録会場は負のidで仮に置く
  // (「未登録なので金額が付かない」を件数として可視化するため。DBには書かない)
  const studios: NamedRef[] = studioRows.map((s) => ({
    id: s.id, name: s.name, aliases: STUDIO_ALIAS_SEED[s.name] ?? [],
  }));
  UNREGISTERED_VENUES.forEach((v, i) => {
    if (!studioRows.some((s) => s.name === v.name)) {
      studios.push({ id: -(i + 1), name: v.name, aliases: v.aliases });
    }
  });

  let events;
  try {
    events = await fetchEventsForRange(`${ym}-01`, `${ym}-${String(lastDay).padStart(2, '0')}`);
  } catch (e) {
    return NextResponse.json(
      { error: `カレンダー取得に失敗: ${e instanceof Error ? e.message : e}` },
      { status: 502 }
    );
  }

  const rows: ResolvedLesson[] = events.map((ev) => resolveCalendarEvent(ev, instructors, studios));
  const held = rows.filter((r) => !r.cancelled);
  const byIssue: Record<string, number> = {};
  for (const r of rows) for (const i of r.issues) byIssue[i] = (byIssue[i] ?? 0) + 1;

  const tally = (key: (r: ResolvedLesson) => string) => {
    const out: Record<string, { コマ: number; 分: number }> = {};
    for (const r of held) {
      const k = key(r);
      out[k] ??= { コマ: 0, 分: 0 };
      out[k].コマ++; out[k].分 += r.duration_minutes;
    }
    return out;
  };

  // 実費型(公共施設)は「借りた日」単位で金額を記録する。同じ日に連続で複数コマ
  // やっていても予約は1本なので、日ごとにまとめて時間帯とクラスを出す。
  // TAROはこれを見て実額を入れるだけでよい(時間から料金を逆算しない=設計の方針)。
  const actualNames = new Set(UNREGISTERED_VENUES.map((v) => v.name));
  const perDay = new Map<string, { 会場: string; 日付: string; 開始: string; 終了: string; コマ: { 時間: string; クラス: string; 講師: string | null }[] }>();
  for (const r of held) {
    if (!r.studio_name || !actualNames.has(r.studio_name)) continue;
    const k = `${r.studio_name}|${r.date}`;
    const cur = perDay.get(k) ?? { 会場: r.studio_name, 日付: r.date, 開始: r.start, 終了: r.end, コマ: [] };
    if (r.start < cur.開始) cur.開始 = r.start;
    if (r.end > cur.終了) cur.終了 = r.end;
    cur.コマ.push({ 時間: `${r.start}-${r.end}`, クラス: r.class_name, 講師: r.instructor_name });
    perDay.set(k, cur);
  }

  return NextResponse.json({
    year_month: ym,
    実費会場の利用日: [...perDay.values()].sort((a, b) =>
      a.会場 === b.会場 ? a.日付.localeCompare(b.日付) : a.会場.localeCompare(b.会場)
    ),
    総イベント数: rows.length,
    開催: held.length,
    休講: rows.length - held.length,
    要確認: held.filter((r) => r.issues.length > 0).length,
    要確認の内訳: byIssue,
    未登録会場: [...new Set(held.filter((r) => (r.studio_id ?? 0) < 0).map((r) => r.studio_name))],
    講師別: tally((r) => r.instructor_name ?? '(不明)'),
    会場別: tally((r) => r.studio_name ?? '(不明)'),
    要確認の明細: held.filter((r) => r.issues.length > 0)
      .map((r) => ({ date: r.date, start: r.start, class_name: r.class_name, issues: r.issues })),
  });
}
