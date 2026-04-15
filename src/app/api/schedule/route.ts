import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const items = db.prepare('SELECT * FROM schedule ORDER BY sort_order ASC').all();
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const db = getDb();
  const body = await req.json();

  if (body.action === 'update') {
    db.prepare('UPDATE schedule SET time = ?, title = ?, description = ? WHERE id = ?')
      .run(body.time, body.title, body.description || '', body.id);
  } else if (body.action === 'delete') {
    db.prepare('DELETE FROM schedule WHERE id = ?').run(body.id);
  } else {
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM schedule').get() as { m: number };
    db.prepare('INSERT INTO schedule (time, title, description, sort_order) VALUES (?, ?, ?, ?)')
      .run(body.time, body.title, body.description || '', (maxOrder.m || 0) + 1);
  }

  const items = db.prepare('SELECT * FROM schedule ORDER BY sort_order ASC').all();
  return NextResponse.json(items);
}
