import { NextRequest, NextResponse } from 'next/server';
import { batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/master/instructors/reorder
// Body: { order: [{ id: number, position: number }] }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const order = body.order;

  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: 'order array required' }, { status: 400 });
  }

  // Validate each entry
  for (const item of order) {
    if (typeof item.id !== 'number' || typeof item.position !== 'number') {
      return NextResponse.json({ error: 'each item needs id (number) and position (number)' }, { status: 400 });
    }
  }

  // Batch update all positions atomically
  const statements = order.map((item: { id: number; position: number }) => ({
    sql: 'UPDATE instructors SET public_display_order = ? WHERE id = ?',
    args: [item.position, item.id],
  }));

  await batch(statements, 'write');

  return NextResponse.json({ ok: true });
}
