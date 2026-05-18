import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/staff/video-preorders/:id
// body: { status?: 'active' | 'duplicate' | 'cancelled' }
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();

  const { id } = await ctx.params;
  const preorderId = parseInt(id, 10);
  if (isNaN(preorderId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const status = body.status as string | undefined;

  if (status && !['active', 'duplicate', 'cancelled'].includes(status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  // status='active' は NULL に戻す (DBの初期値がNULLで運用されているため)
  const dbStatus = status === 'active' ? null : status;
  await execute('UPDATE video_preorders SET status = ? WHERE id = ?', [dbStatus, preorderId]);

  return NextResponse.json({ ok: true, id: preorderId, status: dbStatus });
}
