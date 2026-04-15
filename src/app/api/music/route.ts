import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const releases = await getAll('SELECT * FROM music_releases ORDER BY sort_order ASC');

    const now = new Date();
    const result = releases.map((r: any) => {
      if (r.release_at && new Date(r.release_at) > now) {
        return {
          ...r,
          apple_music_url: '',
          spotify_url: '',
          amazon_music_url: '',
          youtube_music_url: '',
          is_upcoming: true,
        };
      }
      return { ...r, is_upcoming: false };
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch music releases' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const maxOrder = await getOne('SELECT MAX(sort_order) as m FROM music_releases');
    const result = await execute(
      'INSERT INTO music_releases (artist, title, jacket_url, apple_music_url, spotify_url, amazon_music_url, youtube_music_url, release_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [body.artist, body.title, body.jacket_url ?? '', body.apple_music_url ?? '', body.spotify_url ?? '', body.amazon_music_url ?? '', body.youtube_music_url ?? '', body.release_at ?? '', (maxOrder?.m ?? 0) + 1]
    );
    const item = await getOne('SELECT * FROM music_releases WHERE id = ?', [result.lastInsertRowid]);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add music release' }, { status: 500 });
  }
}
