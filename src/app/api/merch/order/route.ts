import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const orders = db.prepare(`
      SELECT mo.*, m.name as merch_name, m.price as merch_price
      FROM merch_orders mo
      JOIN merchandise m ON mo.merch_id = m.id
      ORDER BY mo.created_at DESC
    `).all();
    return NextResponse.json(orders);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch orders' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { merch_id, buyer_name, payment_method } = body;

    // Check stock
    const item = db.prepare('SELECT * FROM merchandise WHERE id = ? AND active = 1').get(merch_id) as { stock: number } | undefined;
    if (!item) {
      return NextResponse.json({ error: 'Merchandise not found' }, { status: 404 });
    }
    if (item.stock <= 0) {
      return NextResponse.json({ error: 'Out of stock' }, { status: 400 });
    }

    // Decrement stock and create order in a transaction
    const placeOrder = db.transaction(() => {
      db.prepare('UPDATE merchandise SET stock = stock - 1 WHERE id = ?').run(merch_id);
      const result = db.prepare(
        'INSERT INTO merch_orders (merch_id, buyer_name, payment_method) VALUES (?, ?, ?)'
      ).run(merch_id, buyer_name, payment_method);
      return result.lastInsertRowid;
    });

    const orderId = placeOrder();
    const order = db.prepare('SELECT * FROM merch_orders WHERE id = ?').get(orderId);
    return NextResponse.json(order);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  }
}
