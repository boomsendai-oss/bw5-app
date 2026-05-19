import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/staff/schedule/instances/[id]
// 既存lesson_instanceの編集 (時間/場所/インストラクター/休講)
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const fields = ['start_time', 'end_time', 'studio_id', 'instructor_id', 'status', 'notes'];
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); args.push(body[f]); }
  }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(Number(id));
  await execute(`UPDATE lesson_instances SET ${updates.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}

// DELETE /api/staff/schedule/instances/[id]
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  await execute(`DELETE FROM lesson_instances WHERE id = ?`, [Number(id)]);
  return NextResponse.json({ ok: true });
}
