import { NextRequest, NextResponse } from 'next/server';
import { getAll, getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET all performances or single by ?m_id=M1
export async function GET(req: NextRequest) {
  const mId = req.nextUrl.searchParams.get('m_id');
  if (mId) {
    const item = await getOne('SELECT * FROM performances WHERE m_id = ?', [mId]);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(item);
  }
  const items = await getAll('SELECT * FROM performances ORDER BY part ASC, CAST(SUBSTR(m_id, 2) AS INTEGER) ASC');
  return NextResponse.json(items);
}

// POST — create or update
export async function POST(req: NextRequest) {
  const body = await req.json();

  if (body.action === 'update') {
    await execute(
      `UPDATE performances SET
        title = ?, title_reading = ?, instructor = ?,
        instructor_photo_url = ?, performer_count = ?,
        genre = ?, song_name = ?, part = ?
      WHERE m_id = ?`,
      [
        body.title, body.title_reading || '', body.instructor || '',
        body.instructor_photo_url || '', body.performer_count || 0,
        body.genre || '', body.song_name || '', body.part || 1,
        body.m_id,
      ]
    );
  } else if (body.action === 'delete') {
    await execute('DELETE FROM performances WHERE m_id = ?', [body.m_id]);
  } else {
    await execute(
      `INSERT OR REPLACE INTO performances
        (m_id, title, title_reading, instructor, instructor_photo_url, performer_count, genre, song_name, part)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        body.m_id, body.title, body.title_reading || '', body.instructor || '',
        body.instructor_photo_url || '', body.performer_count || 0,
        body.genre || '', body.song_name || '', body.part || 1,
      ]
    );
  }

  const items = await getAll('SELECT * FROM performances ORDER BY part ASC, CAST(SUBSTR(m_id, 2) AS INTEGER) ASC');
  return NextResponse.json(items);
}
