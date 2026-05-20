import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/staff/schedule/instances/[id]
// 既存lesson_instanceの編集 (時間/場所/インストラクター/休講)
/** パスのidを正の整数として検証。不正なら null (呼び出し側で400) */
function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const fields = ['start_time', 'end_time', 'studio_id', 'instructor_id', 'status', 'notes'];
  const updates: string[] = [];
  const args: (string | number | null)[] = [];
  for (const f of fields) {
    if (body[f] !== undefined) { updates.push(`${f} = ?`); args.push(body[f]); }
  }
  if (updates.length === 0) return NextResponse.json({ ok: true, noop: true });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  args.push(numId);
  await execute(`UPDATE lesson_instances SET ${updates.join(', ')} WHERE id = ?`, args);
  return NextResponse.json({ ok: true });
}

// DELETE /api/staff/schedule/instances/[id]
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(`DELETE FROM lesson_instances WHERE id = ?`, [numId]);
  return NextResponse.json({ ok: true });
}
