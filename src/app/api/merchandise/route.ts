import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface MerchVariant {
  id: number;
  merch_id: number;
  color: string;
  size: string;
  stock: number;
  sort_order: number;
}

interface MerchItem {
  id: number;
  name: string;
  price: number;
  image_url: string;
  stock: number;
  description: string;
  sort_order: number;
  active: number;
  purchase_at_booth?: number;
  variants?: MerchVariant[];
}

async function loadAll() {
  const items = (await getAll(
    'SELECT * FROM merchandise WHERE active = 1 ORDER BY sort_order ASC'
  )) as unknown as MerchItem[];
  const variants = (await getAll(
    'SELECT * FROM merch_variants ORDER BY merch_id ASC, sort_order ASC'
  )) as unknown as MerchVariant[];
  const orders = await getAll(
    'SELECT id, merch_id, variant_id, color, size, buyer_name, quantity, status, created_at FROM merch_orders ORDER BY created_at DESC'
  );
  const withVariants = items.map((m) => ({
    ...m,
    variants: variants.filter((v) => v.merch_id === m.id),
  }));
  return { items: withVariants, orders };
}

export async function GET() {
  try {
    const data = await loadAll();
    return NextResponse.json(data);
  } catch (e) {
    console.error('merchandise GET err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    if (action === 'add') {
      const max = await getOne('SELECT MAX(sort_order) as m FROM merchandise');
      await execute(
        'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)',
        [
          body.name,
          Number(body.price) || 0,
          body.image_url ?? '',
          Number(body.stock) || 0,
          body.description ?? '',
          Number(max?.m ?? 0) + 1,
        ]
      );
    } else if (action === 'update') {
      await execute(
        'UPDATE merchandise SET name = ?, price = ?, image_url = ?, stock = ?, description = ? WHERE id = ?',
        [
          body.name,
          Number(body.price) || 0,
          body.image_url ?? '',
          Number(body.stock) || 0,
          body.description ?? '',
          Number(body.id),
        ]
      );
    } else if (action === 'update_stock') {
      await execute('UPDATE merchandise SET stock = ? WHERE id = ?', [
        Number(body.stock) || 0,
        Number(body.id),
      ]);
    } else if (action === 'update_variant_stock') {
      // body: { id (variant id), stock }
      await execute('UPDATE merch_variants SET stock = ? WHERE id = ?', [
        Number(body.stock) || 0,
        Number(body.id),
      ]);
    } else if (action === 'delete') {
      // soft delete (active=0)
      await execute('UPDATE merchandise SET active = 0 WHERE id = ?', [Number(body.id)]);
    } else if (action === 'add_variant') {
      // body: { merch_id, color?, size?, stock? }
      const merchId = Number(body.merch_id);
      const color = body.color ?? '';
      const size = body.size ?? '';
      const stock = Number(body.stock) || 0;
      const max = await getOne('SELECT MAX(sort_order) as m FROM merch_variants WHERE merch_id = ?', [merchId]);
      await execute(
        'INSERT INTO merch_variants (merch_id, color, size, stock, sort_order) VALUES (?, ?, ?, ?, ?)',
        [merchId, color, size, stock, Number(max?.m ?? 0) + 1]
      );
    } else if (action === 'delete_variant') {
      // body: { id (variant id) }
      await execute('DELETE FROM merch_variants WHERE id = ?', [Number(body.id)]);
    } else {
      return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }

    const data = await loadAll();
    return NextResponse.json(data);
  } catch (e) {
    console.error('merchandise POST err', e);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
