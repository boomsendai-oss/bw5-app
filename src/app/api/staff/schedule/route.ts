import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

type ScheduleRow = {
  id: number;
  day_of_week: number | null;
  start_time: string | null;
  end_time: string | null;
  class_name: string;
  target: string | null;
  location: string | null;
  instructor: string | null;
  status: string;
  notes: string | null;
  exception_date: string | null;
  exception_type: string | null;
  override_start_time: string | null;
  override_end_time: string | null;
  override_location: string | null;
  override_instructor: string | null;
  base_schedule_id: number | null;
  created_at: string | null;
  updated_at: string | null;
};

// GET /api/staff/schedule
//   ?from=YYYY-MM-DD&to=YYYY-MM-DD : 期間内の例外を併せて返す
//   ?day_of_week=0..6 / ?status=active/休講/廃止 : フィルタ
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const url = new URL(req.url);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');
  const dow = url.searchParams.get('day_of_week');
  const status = url.searchParams.get('status');

  // 通常パターン (exception_date IS NULL)
  const whereRegular: string[] = ['exception_date IS NULL'];
  const argsRegular: (string | number)[] = [];
  if (dow !== null && dow !== '') {
    whereRegular.push('day_of_week = ?');
    argsRegular.push(Number(dow));
  }
  if (status) {
    whereRegular.push('status = ?');
    argsRegular.push(status);
  }
  const regular = (await getAll(
    `SELECT * FROM lesson_schedule WHERE ${whereRegular.join(' AND ')}
     ORDER BY day_of_week ASC, start_time ASC, id ASC`,
    argsRegular
  )) as ScheduleRow[];

  // 例外
  const whereException: string[] = ['exception_date IS NOT NULL'];
  const argsException: (string | number)[] = [];
  if (from) {
    whereException.push('exception_date >= ?');
    argsException.push(from);
  }
  if (to) {
    whereException.push('exception_date <= ?');
    argsException.push(to);
  }
  const exceptions = (await getAll(
    `SELECT * FROM lesson_schedule WHERE ${whereException.join(' AND ')}
     ORDER BY exception_date ASC, id ASC`,
    argsException
  )) as ScheduleRow[];

  return NextResponse.json({ regular, exceptions });
}

type PostBody = Partial<ScheduleRow>;

// POST /api/staff/schedule — 通常パターン or 例外を新規登録
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = (await req.json().catch(() => ({}))) as PostBody;

  if (!body.class_name || !String(body.class_name).trim()) {
    return NextResponse.json({ error: 'class_name is required' }, { status: 400 });
  }

  const result = await execute(
    `INSERT INTO lesson_schedule (
      day_of_week, start_time, end_time, class_name, target, location, instructor, status, notes,
      exception_date, exception_type, override_start_time, override_end_time,
      override_location, override_instructor, base_schedule_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.day_of_week ?? null,
      body.start_time ?? null,
      body.end_time ?? null,
      String(body.class_name).trim(),
      body.target ?? null,
      body.location ?? null,
      body.instructor ?? null,
      body.status ?? 'active',
      body.notes ?? null,
      body.exception_date ?? null,
      body.exception_type ?? null,
      body.override_start_time ?? null,
      body.override_end_time ?? null,
      body.override_location ?? null,
      body.override_instructor ?? null,
      body.base_schedule_id ?? null,
    ]
  );

  const newId = Number(result.lastInsertRowid ?? 0);
  const after = (await getAll('SELECT * FROM lesson_schedule WHERE id = ?', [newId]))[0] ?? null;

  await execute(
    `INSERT INTO lesson_schedule_history (schedule_id, action, before_json, after_json) VALUES (?, ?, ?, ?)`,
    [newId, body.exception_date ? 'exception_added' : 'created', null, JSON.stringify(after)]
  );

  return NextResponse.json({ ok: true, id: newId, schedule: after });
}
