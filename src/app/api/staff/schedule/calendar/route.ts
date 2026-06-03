import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { isMonthConfirmed } from '@/lib/monthConfirm';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/schedule/calendar?year=YYYY&month=MM
// 指定月の日別レッスン一覧を返す
//
// データソース:
//   1. lesson_instances (実開催インスタンス, 既存があれば優先)
//   2. lesson_master (定常クラス, 週次パターンから展開)
//
// 1がない日付は2から自動展開する (簡易RRULE展開)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const now = new Date();
  // year/month は不正値・範囲外 (month=0,13, year=NaN 等) のとき今日基準にフォールバックし、
  // YYYY-MM-DD 文字列やDate演算が破綻しないようにする
  const rawYear = parseInt(url.searchParams.get('year') ?? '', 10);
  const rawMonth = parseInt(url.searchParams.get('month') ?? '', 10);
  const year = Number.isInteger(rawYear) && rawYear >= 2000 && rawYear <= 2100 ? rawYear : now.getFullYear();
  const month = Number.isInteger(rawMonth) && rawMonth >= 1 && rawMonth <= 12 ? rawMonth : now.getMonth() + 1;

  // 月初〜月末
  const monthEnd = new Date(year, month, 0); // 月末日
  const daysInMonth = monthEnd.getDate();

  // この月が「確定(凍結)」済みなら master 週次展開をスキップし instance のみを使う。
  // (確定時に materialize 済みなので予定は instance として残っている)
  const yearMonth = `${year}-${String(month).padStart(2, '0')}`;
  const confirmed = await isMonthConfirmed(yearMonth);

  // 1. lesson_instances を取得
  const startStr = `${year}-${String(month).padStart(2, '0')}-01`;
  const endStr = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

  type Instance = {
    id: number;
    master_id: number | null;
    date: string;
    start_time: string;
    end_time: string;
    studio_id: number | null;
    instructor_id: number | null;
    status: string;
    notes: string | null;
    master_class_name: string | null;
    studio_name: string | null;
    instructor_name: string | null;
  };
  const instances = (await getAll(
    `SELECT li.*, lm.class_name AS master_class_name, s.name AS studio_name, i.name AS instructor_name
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     LEFT JOIN studios s ON s.id = li.studio_id
     LEFT JOIN instructors i ON i.id = li.instructor_id
     WHERE li.date BETWEEN ? AND ?
     ORDER BY li.date, li.start_time`,
    [startStr, endStr]
  )) as Instance[];

  // 2. lesson_master を取得 (週次パターンの展開用)
  type Master = {
    id: number;
    class_name: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
    duration_minutes: number;
    frequency_type: string | null;
    default_studio_id: number | null;
    default_instructor_id: number | null;
    studio_name: string | null;
    instructor_name: string | null;
    start_date: string | null;
    end_date: string | null;
  };
  const masters = (await getAll(
    `SELECT lm.id, lm.class_name, lm.default_day_of_week AS day_of_week, lm.default_start_time AS start_time,
            lm.default_end_time AS end_time, lm.duration_minutes, lm.frequency_type,
            lm.default_studio_id, lm.default_instructor_id, lm.start_date, lm.end_date,
            s.name AS studio_name, i.name AS instructor_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     LEFT JOIN instructors i ON i.id = lm.default_instructor_id
     WHERE lm.active = 1`
  )) as Master[];

  // 日別に整理
  type DayLesson = {
    source: 'instance' | 'master';
    instance_id?: number;
    master_id?: number;
    class_name: string;
    start_time: string;
    end_time: string;
    studio_name: string | null;
    instructor_name: string | null;
    status?: string;
    notes?: string | null;
    frequency_type?: string | null;
  };

  const days: { date: string; day_of_week: number; lessons: DayLesson[] }[] = [];

  for (let d = 1; d <= daysInMonth; d++) {
    const dateObj = new Date(year, month - 1, d);
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dow = dateObj.getDay(); // 0=日 ... 6=土

    const lessons: DayLesson[] = [];

    // a) lesson_instances からその日のレッスン
    const dayInstances = instances.filter(i => i.date.startsWith(dateStr));
    for (const ins of dayInstances) {
      // status='removed' は「そもそも無かった」扱い → カレンダー一覧に出さない。
      // (休講=cancelled は横線表示で残す)。ただし下記 b) の alreadyExpanded 判定には
      //  dayInstances 全件を使うので、master 週次再展開は removed でも抑止される。
      if (ins.status === 'removed') continue;
      lessons.push({
        source: 'instance',
        instance_id: ins.id,
        master_id: ins.master_id ?? undefined,
        class_name: ins.master_class_name ?? '不明',
        start_time: ins.start_time,
        end_time: ins.end_time,
        studio_name: ins.studio_name,
        instructor_name: ins.instructor_name,
        status: ins.status,
        notes: ins.notes,
      });
    }

    // b) lesson_master の週次展開 (instance が無い場合のみ表示)
    // 確定(凍結)済み月では master 展開しない (instance スナップショットのみ)
    for (const m of confirmed ? [] : masters) {
      if (m.day_of_week !== dow) continue;
      // 開始日/終了日の範囲外は展開しない (終了したレッスンを二度と出さない)
      if (m.start_date && dateStr < m.start_date) continue;
      if (m.end_date && dateStr > m.end_date) continue;
      // 該当 master の instance がこの日に既にあればスキップ
      const alreadyExpanded = dayInstances.some(i => i.master_id === m.id);
      if (alreadyExpanded) continue;
      // frequency_type 簡易展開:
      // - weekly: 毎週表示
      // - biweekly / monthly_n / irregular: 簡易的に毎週表示 (細かい RRULE は Phase 2)
      lessons.push({
        source: 'master',
        master_id: m.id,
        class_name: m.class_name,
        start_time: m.start_time,
        end_time: m.end_time,
        studio_name: m.studio_name,
        instructor_name: m.instructor_name,
        frequency_type: m.frequency_type,
      });
    }

    // 時間順ソート
    lessons.sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''));

    days.push({ date: dateStr, day_of_week: dow, lessons });
  }

  return NextResponse.json({
    year,
    month,
    days,
    masters_count: masters.length,
    instances_count: instances.length,
    confirmed,
  });
}
