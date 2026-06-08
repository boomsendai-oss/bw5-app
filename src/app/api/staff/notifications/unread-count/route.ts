import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/notifications/unread-count
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const row = await getOne(
    `SELECT COUNT(*) as count FROM staff_notifications WHERE acknowledged_at IS NULL`
  );

  return NextResponse.json({ count: Number(row?.count ?? 0) });
}
