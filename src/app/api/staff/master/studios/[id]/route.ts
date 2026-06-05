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
  const row = await getOne(`SELECT * FROM studios WHERE id = ?`, [numId]);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ studio: row });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const allowed = ['name','address','google_map_url','pricing_model','hourly_rate','block_pricing','daily_buffer_minutes','notes','active','is_public','map_embed_url','access_text'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of allowed) {
    if (k in body) {
      sets.push(`${k} = ?`);
      const v = body[k];
      vals.push(k === 'block_pricing' && v && typeof v !== 'string' ? JSON.stringify(v) : v);
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'no fields' }, { status: 400 });
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  vals.push(numId);
  await execute(`UPDATE studios SET ${sets.join(', ')} WHERE id = ?`, vals);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const numId = parseId(id);
  if (numId === null) return NextResponse.json({ error: 'invalid id' }, { status: 400 });
  await execute(`DELETE FROM studios WHERE id = ?`, [numId]);
  return NextResponse.json({ ok: true });
}
