import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await req.json();
    db.prepare('UPDATE vote_candidates SET name = ? WHERE id = ?').run(body.name, id);
    const updated = db.prepare('SELECT * FROM vote_candidates WHERE id = ?').get(id);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update candidate' }, { status: 500 });
  }
}
