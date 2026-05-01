import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';
import { autoCancelExpiredOrders } from '@/lib/autoCancel';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Auto-cancel any pending orders past the pickup deadline so stock is fresh
    await autoCancelExpiredOrders();

    const items = await getAll(
      'SELECT * FROM merchandise WHERE active = 1 ORDER BY sort_order ASC'
    );
    const variants = await getAll(
      'SELECT * FROM merch_variants ORDER BY merch_id ASC, sort_order ASC'
    );
    const withVariants = items.map((m: Record<string, unknown>) => ({
      ...m,
      variants: variants.filter(
        (v: Record<string, unknown>) => v.merch_id === m.id
      ),
    }));
    return NextResponse.json(withVariants);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch merchandise' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const maxOrder = await getOne('SELECT MAX(sort_order) as m FROM merchandise');
    const result = await execute(
      'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)',
      [body.name, body.price, body.image_url ?? '', body.stock ?? 0, body.description ?? '', (maxOrder?.m ?? 0) + 1]
    );
    const item = await getOne('SELECT * FROM merchandise WHERE id = ?', [result.lastInsertRowid]);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add merchandise' }, { status: 500 });
  }
}
