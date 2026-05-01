import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne } from '@/lib/db';
import { autoCancelExpiredOrders } from '@/lib/autoCancel';

export const dynamic = 'force-dynamic';

// GET /api/staff/orders?token=XXX
// Returns merch orders + lottery winners + summary for staff iPad view
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = await getOne("SELECT value FROM settings WHERE key = 'staff_orders_token'");
    if (!expected?.value || token !== expected.value) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }

    // Auto-cancel expired pending orders before listing
    await autoCancelExpiredOrders();

    const orders = await getAll(`
      SELECT o.id, o.merch_id, o.color, o.size, o.buyer_name, o.email,
             o.quantity, o.payment_method, o.status, o.created_at,
             m.name AS merch_name, m.price
      FROM merch_orders o
      LEFT JOIN merchandise m ON m.id = o.merch_id
      ORDER BY o.created_at DESC
    `);

    const winners = await getAll(`
      SELECT id, fingerprint, prize_name, prize_tier, winner_name, created_at
      FROM lottery_entries
      WHERE won = 1
      ORDER BY created_at ASC
    `);

    // status は order route で 'pending' / 'pending_cash' / 'awaiting_payment' のいずれかが入る
    const isPending = (s: string) => s === 'pending' || s === 'pending_cash' || s === 'awaiting_payment';
    const isPaid = (s: string) => s === 'paid' || s === 'completed';
    const summary = {
      total_orders: orders.length,
      pending: orders.filter((o: { status: string }) => isPending(o.status)).length,
      paid: orders.filter((o: { status: string }) => isPaid(o.status)).length,
      total_winners: winners.length,
    };

    return NextResponse.json({ orders, winners, summary });
  } catch (e) {
    console.error('staff/orders GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

// POST /api/staff/orders — update order status (mark as picked up / paid)
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') || '';
    const expected = await getOne("SELECT value FROM settings WHERE key = 'staff_orders_token'");
    if (!expected?.value || token !== expected.value) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 403 });
    }
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) return NextResponse.json({ error: 'Missing' }, { status: 400 });

    const { execute } = await import('@/lib/db');
    await execute('UPDATE merch_orders SET status = ? WHERE id = ?', [status, id]);
    return NextResponse.json({ success: true });
  } catch (e) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
