import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { getInstructorBySession } from '@/lib/instructorAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/instructor/lessons?year_month=YYYY-MM
export async function GET(req: NextRequest) {
  const me = await getInstructorBySession(req);
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const url = new URL(req.url);
  const ym = url.searchParams.get('year_month');
  const today = new Date();
  const target = ym ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = target.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const start = `${target}-01`;
  const end = `${target}-${String(lastDay).padStart(2, '0')}`;

  // 担当lesson_master
  const masters = await getAll(
    `SELECT lm.id, lm.class_name, lm.default_day_of_week, lm.default_start_time, lm.default_end_time, lm.duration_minutes,
            s.name AS studio_name
     FROM lesson_master lm LEFT JOIN studios s ON s.id = lm.default_studio_id
     WHERE lm.default_instructor_id = ? AND lm.active = 1
     ORDER BY lm.default_day_of_week, lm.default_start_time`,
    [me.id]
  );
  // 当月のlesson_instances (実開催)
  const instances = await getAll(
    `SELECT li.id, li.date, li.start_time, li.end_time, li.status, lm.class_name, s.name AS studio_name
     FROM lesson_instances li
     LEFT JOIN lesson_master lm ON lm.id = li.master_id
     LEFT JOIN studios s ON s.id = li.studio_id
     WHERE li.instructor_id = ? AND li.date BETWEEN ? AND ?
     ORDER BY li.date, li.start_time`,
    [me.id, start, end]
  );
  // 当月の休講申請
  const cancelRequests = await getAll(
    `SELECT * FROM lesson_cancel_requests WHERE instructor_id = ? AND lesson_date BETWEEN ? AND ?
     ORDER BY lesson_date`,
    [me.id, start, end]
  );
  return NextResponse.json({ year_month: target, masters, instances, cancel_requests: cancelRequests });
}
