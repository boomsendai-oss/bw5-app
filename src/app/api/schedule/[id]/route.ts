import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await execute('UPDATE schedule SET time = ?, title = ?, description = ?, sort_order = ? WHERE id = ?',
      [body.time, body.title, body.description ?? '', body.sort_order ?? 0, id]);
    const updated = await getOne('SELECT * FROM schedule WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update schedule item' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await execute('DELETE FROM schedule WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete schedule item' }, { status: 500 });
  }
}
