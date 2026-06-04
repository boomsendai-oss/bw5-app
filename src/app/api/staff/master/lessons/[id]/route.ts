import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** パスのidを正の整数として検証。不正なら null (呼び出し側で400) */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const row = await getOne(`SELECT * FROM lesson_master WHERE id = ?`, [numId]);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ lesson: row });
}

// PATCH /api/staff/master/lessons/[id] — 個別部分更新
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const allowed = [
    'class_name', 'target', 'level', 'default_studio_id', 'default_instructor_id',
    'default_day_of_week', 'default_start_time', 'default_end_time', 'duration_minutes',
    'frequency_type', 'override_rate', 'active', 'notes', 'start_date', 'end_date',
    'description_text',
  ];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in body) {
      sets.push(`${k} = ?`);
      vals.push(body[k]);
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  vals.push(numId);
  await execute(`UPDATE lesson_master SET ${sets.join(', ')} WHERE id = ?`, vals);
  return NextResponse.json({ ok: true });
}

// DELETE /api/staff/master/lessons/[id] — 無効化 (active=0)。物理削除はしない
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(`UPDATE lesson_master SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [numId]);
  return NextResponse.json({ ok: true });
}
