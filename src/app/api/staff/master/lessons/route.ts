import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/master/lessons
// デフォルト: active=1 のみ (カレンダー等の既存呼び出し互換)
// ?all=1: active 問わず全件返す (編集UI用)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const all = req.nextUrl.searchParams.get('all') === '1';
  const where = all ? '' : 'WHERE lm.active = 1';
  const lessons = await getAll(
    `SELECT lm.*, s.name AS studio_name, i.name AS instructor_name
     FROM lesson_master lm
     LEFT JOIN studios s ON s.id = lm.default_studio_id
     LEFT JOIN instructors i ON i.id = lm.default_instructor_id
     ${where}
     ORDER BY lm.default_day_of_week, lm.default_start_time`
  );
  return NextResponse.json({ lessons });
}

// POST /api/staff/master/lessons — 新規レッスン作成
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.class_name) return NextResponse.json({ error: 'class_name required' }, { status: 400 });
  const result = await execute(
    `INSERT INTO lesson_master
       (class_name, target, level, default_studio_id, default_instructor_id,
        default_day_of_week, default_start_time, default_end_time, duration_minutes,
        frequency_type, active, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.class_name,
      body.target ?? null,
      body.level ?? null,
      body.default_studio_id ?? null,
      body.default_instructor_id ?? null,
      body.default_day_of_week ?? null,
      body.default_start_time ?? null,
      body.default_end_time ?? null,
      body.duration_minutes ?? null,
      body.frequency_type ?? null,
      body.active ?? 1,
      body.notes ?? null,
    ]
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
