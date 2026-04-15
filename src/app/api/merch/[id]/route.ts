import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await execute(
      'UPDATE merchandise SET name = ?, price = ?, image_url = ?, stock = ?, description = ?, sort_order = ?, active = ? WHERE id = ?',
      [body.name, body.price, body.image_url ?? '', body.stock ?? 0, body.description ?? '', body.sort_order ?? 0, body.active ?? 1, id]
    );
    const updated = await getOne('SELECT * FROM merchandise WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update merchandise' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await execute('DELETE FROM merchandise WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete merchandise' }, { status: 500 });
  }
}
