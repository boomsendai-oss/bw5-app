import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { deleteSignup } from '@/lib/eventSignupDb';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ eventId: string; signupId: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { eventId, signupId } = await ctx.params;
  await deleteSignup(Number(eventId), Number(signupId));
  return NextResponse.json({ ok: true });
}
