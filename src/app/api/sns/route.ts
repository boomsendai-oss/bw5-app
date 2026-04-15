import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const links = db.prepare('SELECT * FROM sns_links ORDER BY sort_order ASC').all();
    return NextResponse.json(links);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch SNS links' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const db = getDb();
    const body = await req.json();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM sns_links').get() as { m: number | null };
    const result = db.prepare(
      'INSERT INTO sns_links (platform, url, sort_order) VALUES (?, ?, ?)'
    ).run(body.platform, body.url, (maxOrder.m ?? 0) + 1);
    const item = db.prepare('SELECT * FROM sns_links WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add SNS link' }, { status: 500 });
  }
}
