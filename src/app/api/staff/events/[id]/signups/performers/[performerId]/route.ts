import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { updatePerformer, deletePerformer } from '@/lib/eventSignupDb';
import { isPartKey, type PartKey } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string; performerId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id, performerId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const name = String(body?.name ?? '').trim();
  if (!name) return NextResponse.json({ error: '名前は必須です' }, { status: 400 });
  const parts = (Array.isArray(body?.parts) ? body.parts : []).filter(isPartKey) as PartKey[];
  if (parts.length === 0) return NextResponse.json({ error: 'パートを1つ以上選んでください' }, { status: 400 });
  const ok = await updatePerformer(Number(id), Number(performerId), name, parts);
  if (!ok) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string; performerId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id, performerId } = await ctx.params;
  await deletePerformer(Number(id), Number(performerId));
  return NextResponse.json({ ok: true });
}
