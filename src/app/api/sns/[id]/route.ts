import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await req.json();
    db.prepare('UPDATE sns_links SET platform = ?, url = ?, sort_order = ? WHERE id = ?')
      .run(body.platform, body.url, body.sort_order ?? 0, id);
    const updated = db.prepare('SELECT * FROM sns_links WHERE id = ?').get(id);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update SNS link' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM sns_links WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete SNS link' }, { status: 500 });
  }
}
