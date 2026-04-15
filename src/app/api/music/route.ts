import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const releases = db.prepare('SELECT * FROM music_releases ORDER BY sort_order ASC').all() as Array<{
      id: number;
      artist: string;
      title: string;
      jacket_url: string;
      apple_music_url: string;
      spotify_url: string;
      amazon_music_url: string;
      youtube_music_url: string;
      release_at: string;
      sort_order: number;
    }>;

    const now = new Date();
    const result = releases.map((r) => {
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
    const db = getDb();
    const body = await req.json();
    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM music_releases').get() as { m: number | null };
    const result = db.prepare(
      'INSERT INTO music_releases (artist, title, jacket_url, apple_music_url, spotify_url, amazon_music_url, youtube_music_url, release_at, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      body.artist,
      body.title,
      body.jacket_url ?? '',
      body.apple_music_url ?? '',
      body.spotify_url ?? '',
      body.amazon_music_url ?? '',
      body.youtube_music_url ?? '',
      body.release_at ?? '',
      (maxOrder.m ?? 0) + 1
    );
    const item = db.prepare('SELECT * FROM music_releases WHERE id = ?').get(result.lastInsertRowid);
    return NextResponse.json(item);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add music release' }, { status: 500 });
  }
}
