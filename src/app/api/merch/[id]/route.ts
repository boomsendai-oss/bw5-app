import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await req.json();
    db.prepare(
      'UPDATE merchandise SET name = ?, price = ?, image_url = ?, stock = ?, description = ?, sort_order = ?, active = ? WHERE id = ?'
    ).run(
      body.name,
      body.price,
      body.image_url ?? '',
      body.stock ?? 0,
      body.description ?? '',
      body.sort_order ?? 0,
      body.active ?? 1,
      id
    );
    const updated = db.prepare('SELECT * FROM merchandise WHERE id = ?').get(id);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update merchandise' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM merchandise WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete merchandise' }, { status: 500 });
  }
}
