import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'video_price'").get() as { value: string } | undefined;
    const price = setting ? parseInt(setting.value, 10) : 0;
    return NextResponse.json({ price });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch video info' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const { buyer_name, email, payment_method } = body;

    const result = db.prepare(
      'INSERT INTO video_orders (buyer_name, email, payment_method) VALUES (?, ?, ?)'
    ).run(buyer_name, email, payment_method);

    const order = db.prepare('SELECT * FROM video_orders WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(order);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create video order' }, { status: 500 });
  }
}
