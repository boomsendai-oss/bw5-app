import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// GET /api/staff/events/[id] — single event
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await params;
  const event = await getOne('SELECT * FROM events WHERE id = ?', [id]);
  if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ event });
}
