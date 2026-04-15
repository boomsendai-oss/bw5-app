import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const items = await getAll('SELECT * FROM schedule ORDER BY sort_order ASC');
  return NextResponse.json(items);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'update') {
    await execute('UPDATE schedule SET time = ?, title = ?, description = ? WHERE id = ?',
      [body.time, body.title, body.description || '', body.id]);
  } else if (body.action === 'delete') {
    await execute('DELETE FROM schedule WHERE id = ?', [body.id]);
  } else {
    const maxOrder = await getOne('SELECT MAX(sort_order) as m FROM schedule');
    await execute('INSERT INTO schedule (time, title, description, sort_order) VALUES (?, ?, ?, ?)',
      [body.time, body.title, body.description || '', (maxOrder?.m || 0) + 1]);
  }

  const items = await getAll('SELECT * FROM schedule ORDER BY sort_order ASC');
  return NextResponse.json(items);
}
