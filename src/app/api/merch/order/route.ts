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

/**
 * POST /api/merch/order
 * Body: { merch_id, variant_id?, buyer_name, email?, payment_method: 'cash_onsite'|'online_square' }
 * Response: { order, redirect: string|null, checkout_error?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { merch_id, variant_id, buyer_name, email = '', payment_method } = body;

    if (!merch_id || !buyer_name || !payment_method) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['cash_onsite', 'online_square'].includes(payment_method)) {
      return NextResponse.json({ error: 'Invalid payment_method' }, { status: 400 });
    }

    const item = await getOne(
      'SELECT * FROM merchandise WHERE id = ? AND active = 1',
      [merch_id]
    );
    if (!item) {
      return NextResponse.json({ error: 'Merchandise not found' }, { status: 404 });
    }

    let color = '';
    let size = '';
    if (variant_id) {
      const v = await getOne(
        'SELECT * FROM merch_variants WHERE id = ? AND merch_id = ?',
        [variant_id, merch_id]
      );
      if (!v) {
        return NextResponse.json({ error: 'Variant not found' }, { status: 404 });
      }
      if ((v.stock as number) <= 0) {
        return NextResponse.json({ error: 'Out of stock' }, { status: 400 });
      }
      color = (v.color as string) ?? '';
      size = (v.size as string) ?? '';
    } else {
      const v = await getOne(
        'SELECT * FROM merch_variants WHERE merch_id = ? LIMIT 1',
        [merch_id]
      );
      if (v && (v.stock as number) <= 0) {
        return NextResponse.json({ error: 'Out of stock' }, { status: 400 });
      }
    }

    const status =
      payment_method === 'cash_onsite' ? 'pending_cash' : 'awaiting_payment';

    // variant_id 未指定の場合は merchandise 配下の variant を 1件勝手にピック
    // (autoCancel が在庫を戻せるように、本物の variant_id を必ず保存する)
    let effectiveVariantId: number | null = variant_id ?? null;
    if (!effectiveVariantId) {
      const fallback = await getOne(
        'SELECT id FROM merch_variants WHERE merch_id = ? ORDER BY sort_order ASC LIMIT 1',
        [merch_id]
      );
      if (fallback?.id) effectiveVariantId = Number(fallback.id);
    }

    const ops = [];
    if (effectiveVariantId) {
      ops.push({
        sql: 'UPDATE merch_variants SET stock = stock - 1 WHERE id = ?',
        args: [effectiveVariantId],
      });
    }
    ops.push({
      sql: 'UPDATE merchandise SET stock = stock - 1 WHERE id = ?',
      args: [merch_id],
    });
    ops.push({
      sql: `INSERT INTO merch_orders (merch_id, variant_id, color, size, buyer_name, email, payment_method, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        merch_id,
        effectiveVariantId,
        color,
        size,
        buyer_name,
        email,
        payment_method,
        status,
      ],
    });
    const results = await batch(ops, 'write');
    const orderId = results[results.length - 1].lastInsertRowid;
    const order = await getOne('SELECT * FROM merch_orders WHERE id = ?', [orderId]);

    if (payment_method === 'online_square') {
      const checkoutRes = await fetch(
        `${req.nextUrl.origin}/api/merch/checkout`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: orderId }),
        }
      );
      if (!checkoutRes.ok) {
        const err = await checkoutRes.json().catch(() => ({}));
        return NextResponse.json({
          order,
          redirect: null,
          checkout_error: err.error ?? 'Square未設定',
        });
      }
      const { checkout_url } = await checkoutRes.json();
      return NextResponse.json({ order, redirect: checkout_url });
    }

    return NextResponse.json({ order, redirect: null });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to place order' }, { status: 500 });
  }
}

/**
 * PATCH /api/merch/order - admin update status
 * Body: { id, status }
 */
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body;
    if (!id || !status) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 });
    }
    await execute('UPDATE merch_orders SET status = ? WHERE id = ?', [status, id]);
    const order = await getOne('SELECT * FROM merch_orders WHERE id = ?', [id]);
    return NextResponse.json(order);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
