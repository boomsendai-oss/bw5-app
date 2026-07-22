import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { resolveSettings, listByEvent } from '@/lib/eventSignupDb';
import { countByPart, type PartKey } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });

  const settings = await resolveSettings(id);
  const signups = await listByEvent(id);

  const flatPerformers = signups.flatMap((s) => s.performers.map((p) => ({ parts: p.parts as PartKey[] })));
  const counts = countByPart(flatPerformers);
  const byPart = settings.parts.map((p) => ({ key: p.key, label: p.label, count: counts[p.key] ?? 0 }));
  const performerCount = flatPerformers.length;

  return NextResponse.json({
    summary: { signupCount: signups.length, performerCount, byPart },
    parts: settings.parts.map((p) => ({ key: p.key, label: p.label })),
    signups,
  });
}
