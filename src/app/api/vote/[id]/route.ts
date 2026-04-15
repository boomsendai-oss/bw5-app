import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await execute('UPDATE vote_candidates SET name = ? WHERE id = ?', [body.name, id]);
    const updated = await getOne('SELECT * FROM vote_candidates WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update candidate' }, { status: 500 });
  }
}
