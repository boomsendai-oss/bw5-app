import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const setting = await getOne("SELECT value FROM settings WHERE key = 'video_price'");
    const price = setting ? parseInt(setting.value, 10) : 0;
    return NextResponse.json({ price });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch video info' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { buyer_name, email, payment_method } = body;

    const result = await execute(
      'INSERT INTO video_orders (buyer_name, email, payment_method) VALUES (?, ?, ?)',
      [buyer_name, email, payment_method]
    );

    const order = await getOne('SELECT * FROM video_orders WHERE id = ?', [result.lastInsertRowid]);
    return NextResponse.json(order);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create video order' }, { status: 500 });
  }
}
