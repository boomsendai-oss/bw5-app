import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/master/lessons
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const lessons = await getAll(
    `SELECT lm.*, s.name AS studio_name, i.name AS instructor_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     LEFT JOIN instructors i ON i.id = lm.default_instructor_id
     WHERE lm.active = 1
     ORDER BY lm.default_day_of_week, lm.default_start_time`
  );
  return NextResponse.json({ lessons });
}
