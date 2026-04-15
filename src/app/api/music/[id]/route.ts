import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await req.json();
    db.prepare(
      'UPDATE music_releases SET artist = ?, title = ?, jacket_url = ?, apple_music_url = ?, spotify_url = ?, amazon_music_url = ?, youtube_music_url = ?, release_at = ?, sort_order = ? WHERE id = ?'
    ).run(
      body.artist,
      body.title,
      body.jacket_url ?? '',
      body.apple_music_url ?? '',
      body.spotify_url ?? '',
      body.amazon_music_url ?? '',
      body.youtube_music_url ?? '',
      body.release_at ?? '',
      body.sort_order ?? 0,
      id
    );
    const updated = db.prepare('SELECT * FROM music_releases WHERE id = ?').get(id);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update music release' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = getDb();
    db.prepare('DELETE FROM music_releases WHERE id = ?').run(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete music release' }, { status: 500 });
  }
}
