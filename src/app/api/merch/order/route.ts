import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute, batch } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const orders = await getAll(`
      SELECT mo.*, m.name as merch_name, m.price as merch_price
      FROM merch_orders mo
      JOIN merchandise m ON mo.merch_id = m.id
      ORDER BY mo.created_at DESC
    `);
    return NextResponse.json(orders);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { merch_id, buyer_name, payment_method } = body;

    // Check stock
    const item = await getOne('SELECT * FROM merchandise WHERE id = ? AND active = 1', [merch_id]);
    if (!item) {
      return NextResponse.json({ error: 'Merchandise not found' }, { status: 404 });
    }
    if (item.stock <= 0) {
      return NextResponse.json({ error: 'Out of stock' }, { status: 400 });
    }

    // Decrement stock and create order in a batch (transaction)
    const results = await batch([
      { sql: 'UPDATE merchandise SET stock = stock - 1 WHERE id = ?', args: [merch_id] },
      { sql: 'INSERT INTO merch_orders (merch_id, buyer_name, payment_method) VALUES (?, ?, ?)', args: [merch_id, buyer_name, payment_method] },
    ], 'write');

    const orderId = results[1].lastInsertRowid;
    const order = await getOne('SELECT * FROM merch_orders WHERE id = ?', [orderId]);
    return NextResponse.json(order);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  }
}
