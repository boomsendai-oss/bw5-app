import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const links = await getAll('SELECT * FROM sns_links ORDER BY sort_order ASC');
    return NextResponse.json(links);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch SNS links' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const maxOrder = await getOne('SELECT MAX(sort_order) as m FROM sns_links');
    const result = await execute(
      'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)',
      [body.platform, body.url, (maxOrder?.m ?? 0) + 1]
    );
    const item = await getOne('SELECT * FROM sns_links WHERE id = ?', [result.lastInsertRowid]);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add SNS link' }, { status: 500 });
  }
}
