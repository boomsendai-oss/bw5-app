import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

const FIELDS = [
  'day_of_week',
  'start_time',
  'end_time',
  'class_name',
  'target',
  'location',
  'instructor',
  'status',
  'notes',
  'exception_date',
  'exception_type',
  'override_start_time',
  'override_end_time',
  'override_location',
  'override_instructor',
  'base_schedule_id',
] as const;

type Field = (typeof FIELDS)[number];

// GET single
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  const row = await getOne('SELECT * FROM lesson_schedule WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ schedule: row });
}

// PATCH /api/staff/schedule/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;

  const before = await getOne('SELECT * FROM lesson_schedule WHERE id = ?', [id]);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as Partial<Record<Field, unknown>>;
  const sets: string[] = [];
  const args: unknown[] = [];
  for (const f of FIELDS) {
    if (f in body) {
      sets.push(`${f} = ?`);
      args.push(body[f] ?? null);
    }
  }
  if (sets.length === 0) {
    return NextResponse.json({ ok: true, schedule: before });
  }
  sets.push("updated_at = CURRENT_TIMESTAMP");
  args.push(id);

  await execute(`UPDATE lesson_schedule SET ${sets.join(', ')} WHERE id = ?`, args);
  const after = await getOne('SELECT * FROM lesson_schedule WHERE id = ?', [id]);

  await execute(
    `INSERT INTO lesson_schedule_history (schedule_id, action, before_json, after_json) VALUES (?, ?, ?, ?)`,
    [Number(id), 'updated', JSON.stringify(before), JSON.stringify(after)]
  );

  return NextResponse.json({ ok: true, schedule: after });
}

// DELETE /api/staff/schedule/[id] — 物理削除せず status='廃止' に
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  const before = await getOne('SELECT * FROM lesson_schedule WHERE id = ?', [id]);
  if (!before) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  await execute(
    `UPDATE lesson_schedule SET status = '廃止', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [id]
  );
  const after = await getOne('SELECT * FROM lesson_schedule WHERE id = ?', [id]);

  await execute(
    `INSERT INTO lesson_schedule_history (schedule_id, action, before_json, after_json) VALUES (?, ?, ?, ?)`,
    [Number(id), 'deleted', JSON.stringify(before), JSON.stringify(after)]
  );

  return NextResponse.json({ ok: true });
}
