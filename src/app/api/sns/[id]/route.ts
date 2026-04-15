import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await execute('UPDATE sns_links SET platform = ?, url = ?, sort_order = ? WHERE id = ?',
      [body.platform, body.url, body.sort_order ?? 0, id]);
    const updated = await getOne('SELECT * FROM sns_links WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update SNS link' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await execute('DELETE FROM sns_links WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete SNS link' }, { status: 500 });
  }
}
