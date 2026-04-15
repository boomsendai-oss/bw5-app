import { NextRequest, NextResponse } from 'next/server';
import { getOne, execute } from '@/lib/db';

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    await execute(
      'UPDATE music_releases SET artist = ?, title = ?, jacket_url = ?, apple_music_url = ?, spotify_url = ?, amazon_music_url = ?, youtube_music_url = ?, release_at = ?, sort_order = ? WHERE id = ?',
      [body.artist, body.title, body.jacket_url ?? '', body.apple_music_url ?? '', body.spotify_url ?? '', body.amazon_music_url ?? '', body.youtube_music_url ?? '', body.release_at ?? '', body.sort_order ?? 0, id]
    );
    const updated = await getOne('SELECT * FROM music_releases WHERE id = ?', [id]);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update music release' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await execute('DELETE FROM music_releases WHERE id = ?', [id]);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete music release' }, { status: 500 });
  }
}
