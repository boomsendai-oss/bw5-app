import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { resolveSettings, listByEvent } from '@/lib/eventSignupDb';
import { buildSignupCsv, type SignupRowForCsv } from '@/lib/eventSignup';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id: idStr } = await ctx.params;
  const id = Number(idStr);
  const settings = await resolveSettings(id);
  const labels = Object.fromEntries(settings.parts.map((p) => [p.key, p.label]));
  const signups = await listByEvent(id);
  const rows: SignupRowForCsv[] = signups.flatMap((s) =>
    s.performers.map((p) => ({ performerName: p.name, parts: p.parts, createdAt: s.createdAt }))
  );
  const csv = '﻿' + buildSignupCsv(rows, labels);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="taihaku_signups_${id}.csv"`,
    },
  });
}
