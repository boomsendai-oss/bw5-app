import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const items = db.prepare('SELECT * FROM merchandise WHERE active = 1 ORDER BY sort_order ASC').all();
    return NextResponse.json(items);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch merchandise' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM merchandise').get() as { m: number | null };
    const result = db.prepare(
      'INSERT INTO merchandise (name, price, image_url, stock, description, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run(
      body.name,
      body.price,
      body.image_url ?? '',
      body.stock ?? 0,
      body.description ?? '',
      (maxOrder.m ?? 0) + 1
    );
    const item = db.prepare('SELECT * FROM merchandise WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add merchandise' }, { status: 500 });
  }
}
