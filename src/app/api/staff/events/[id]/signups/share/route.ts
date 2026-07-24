import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getOrCreateShareToken } from '@/lib/eventSignupDb';

export const dynamic = 'force-dynamic';

// GET /api/staff/events/[id]/signups/share — 講師共有(読み取り専用)リンクのパスを返す。
// 秘密トークンが無ければ生成して保存する。
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const eventId = Number(id);
  const ev = await getOne('SELECT code FROM events WHERE id = ?', [eventId]);
  if (!ev) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const token = await getOrCreateShareToken(eventId);
  const code = String(ev.code).toLowerCase();
  return NextResponse.json({ path: `/roster/${code}/${token}` });
}
