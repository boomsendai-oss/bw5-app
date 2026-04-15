import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute, batch } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const pages = await getAll('SELECT * FROM pamphlet_pages ORDER BY sort_order ASC');
  return NextResponse.json(pages);
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'add') {
    const maxOrder = await getOne('SELECT MAX(sort_order) as m FROM pamphlet_pages');
    await execute('INSERT INTO pamphlet_pages (image_url, sort_order) VALUES (?, ?)',
      [body.image_url, (maxOrder?.m || 0) + 1]);
  } else if (body.action === 'delete') {
    await execute('DELETE FROM pamphlet_pages WHERE id = ?', [body.id]);
  } else if (body.action === 'reorder') {
    await batch(
      (body.items as { id: number; sort_order: number }[]).map((item) => ({
        sql: 'UPDATE pamphlet_pages SET sort_order = ? WHERE id = ?',
        args: [item.sort_order, item.id],
      })),
      'write'
    );
  }

  const pages = await getAll('SELECT * FROM pamphlet_pages ORDER BY sort_order ASC');
  return NextResponse.json(pages);
}
