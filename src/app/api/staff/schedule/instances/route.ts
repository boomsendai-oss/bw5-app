import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { oneOf, INSTANCE_STATUSES, badRequest } from '@/lib/validate';
import { isIsoDate, isHhmm } from '@/lib/dateJst';

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
  // M13(POST側): PATCH側と同じ検証をここにも入れる。無検証だと date='2026-7-5' や
  // status='休講' がそのままDBに入り、給与計算・Google同期・HACOMONO出力が揃って狂う。
  // (作成時点で弾かないと、PATCH側だけ堅くしても抜け道が残る)
  if (!isIsoDate(body.date)) return badRequest('date は YYYY-MM-DD 形式');
  if (!isHhmm(body.start_time)) return badRequest('start_time は HH:MM 形式');
  if (!isHhmm(body.end_time)) return badRequest('end_time は HH:MM 形式');
  if (body.status !== undefined && !oneOf(body.status, INSTANCE_STATUSES)) {
    return badRequest('status は scheduled/cancelled/removed のいずれか');
  }
  for (const f of ['master_id', 'studio_id', 'instructor_id'] as const) {
    if (body[f] !== undefined && body[f] !== null && !(Number.isInteger(body[f]) && body[f] > 0)) {
      return badRequest(`${f} は正整数か null`);
    }
  }
  // 冪等性: 既存マスターの instance 化は (master_id, date) で重複を防ぐ。
  // 同じ master+date の instance が既にあれば、新規作成せず既存を再利用する
  // (status 指定があれば更新)。これにより「この日だけ編集/休講」を繰り返しても
  // 同じレッスンが重複して増殖しない。
  if (body.master_id) {
    const existing = await getOne(
      `SELECT id FROM lesson_instances WHERE master_id = ? AND date = ? LIMIT 1`,
      [body.master_id, body.date]
    );
    if (existing) {
      const existingId = Number(existing.id);
      if (body.status) {
        await execute(`UPDATE lesson_instances SET status = ?, auto_materialized = 0 WHERE id = ?`, [body.status, existingId]);
      }
      return NextResponse.json({ ok: true, id: existingId, master_id: body.master_id, reused: true });
    }
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
