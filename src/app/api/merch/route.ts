import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const items = await getAll('SELECT * FROM merchandise WHERE active = 1 ORDER BY sort_order ASC');
    return NextResponse.json(items);
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
