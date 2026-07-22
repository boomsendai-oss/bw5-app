import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { resolveSettings, saveSettings } from '@/lib/eventSignupDb';
import { DEFAULT_PARTS, type ResolvedSettings } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const settings = await resolveSettings(Number(id));
  return NextResponse.json({ settings });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const next: ResolvedSettings = {
    parts: Array.isArray(body?.parts) && body.parts.length ? body.parts : DEFAULT_PARTS,
    feeText: String(body?.feeText ?? ''),
    deadline: String(body?.deadline ?? ''),
    introMd: String(body?.introMd ?? ''),
    calendarUrl: String(body?.calendarUrl ?? ''),
    isOpen: Boolean(body?.isOpen),
  };
  await saveSettings(Number(id), next);
  return NextResponse.json({ ok: true, settings: next });
}
