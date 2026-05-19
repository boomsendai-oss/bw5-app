import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/schedule/instances
// 新規lesson_instanceを作成 (カレンダー日付タップ時の新規登録)
//
// body: {
//   date: 'YYYY-MM-DD',
//   start_time: 'HH:MM',
//   end_time: 'HH:MM',
//   master_id?: number,          // 既存マスターから選ぶ場合
//   class_name_override?: string, // 特別レッスン: 自由入力
//   studio_id?: number,
//   instructor_id?: number,
//   status?: 'scheduled' | 'cancelled',
//   notes?: string,
// }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.date || !body.start_time || !body.end_time) {
    return NextResponse.json({ error: 'date, start_time, end_time required' }, { status: 400 });
  }
  if (!body.master_id && !body.class_name_override) {
    return NextResponse.json({ error: 'master_id か class_name_override が必要' }, { status: 400 });
  }
  // 特別レッスン用に簡易lesson_masterを作る (再利用のため)
  let masterId = body.master_id ?? null;
  if (!masterId && body.class_name_override) {
    const r = await execute(
      `INSERT INTO lesson_master (class_name, default_studio_id, default_instructor_id, default_day_of_week, default_start_time, default_end_time, duration_minutes, active, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '特別レッスン (カレンダー作成)')`,
      [
        body.class_name_override,
        body.studio_id ?? null,
        body.instructor_id ?? null,
        new Date(body.date).getDay(),
        body.start_time,
        body.end_time,
        diffMin(body.start_time, body.end_time),
      ]
    );
    masterId = Number(r.lastInsertRowid);
  }
  const result = await execute(
    `INSERT INTO lesson_instances (master_id, date, start_time, end_time, studio_id, instructor_id, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      masterId,
      body.date,
      body.start_time,
      body.end_time,
      body.studio_id ?? null,
      body.instructor_id ?? null,
      body.status ?? 'scheduled',
      body.notes ?? null,
    ]
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid), master_id: masterId });
}

function diffMin(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}
