import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const pages = db.prepare('SELECT * FROM pamphlet_pages ORDER BY sort_order ASC').all();
  return NextResponse.json(pages);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();

  if (body.action === 'add') {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM pamphlet_pages').get() as { m: number };
    db.prepare('INSERT INTO pamphlet_pages (image_url, sort_order) VALUES (?, ?)')
      .run(body.image_url, (maxOrder.m || 0) + 1);
  } else if (body.action === 'delete') {
    db.prepare('DELETE FROM pamphlet_pages WHERE id = ?').run(body.id);
  } else if (body.action === 'reorder') {
    const updateStmt = db.prepare('UPDATE pamphlet_pages SET sort_order = ? WHERE id = ?');
    for (const item of body.items as { id: number; sort_order: number }[]) {
      updateStmt.run(item.sort_order, item.id);
    }
  }

  const pages = db.prepare('SELECT * FROM pamphlet_pages ORDER BY sort_order ASC').all();
  return NextResponse.json(pages);
}
