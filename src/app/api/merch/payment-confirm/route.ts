import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * POST /api/merch/payment-confirm
 * Called from /shop/success after Square Checkout redirect.
 * Body: { order_id, transaction_id? }
 *
 * For MVP: marks the order as `paid`. In production, ideally verifies
 * the transaction via Square Payments API before flipping status.
 */
export async function POST(req: NextRequest) {
  try {
    const { order_id, transaction_id } = await req.json();
    if (!order_id) {
      return NextResponse.json({ error: 'Missing order_id' }, { status: 400 });
    }
    const order = await getOne('SELECT * FROM merch_orders WHERE id = ?', [order_id]);
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    await execute(
      'UPDATE merch_orders SET status = ?, square_payment_id = ? WHERE id = ?',
      ['paid', transaction_id ?? '', order_id]
    );
    const updated = await getOne('SELECT * FROM merch_orders WHERE id = ?', [order_id]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Confirmation failed' }, { status: 500 });
  }
}
