import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// GET /api/staff/events — イベント一覧
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const events = await getAll(
    'SELECT * FROM events ORDER BY (event_date IS NULL), event_date DESC, id DESC'
  );
  return NextResponse.json({ events });
}

// POST /api/staff/events — イベント新規作成
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const body = await req.json();
    const { code, name, event_date, status } = body ?? {};
    if (!code || !name) {
      return NextResponse.json({ error: 'code and name are required' }, { status: 400 });
    }
    const existing = await getOne('SELECT id FROM events WHERE code = ?', [code]);
    if (existing) {
      return NextResponse.json({ error: 'code already exists' }, { status: 409 });
    }
    const result = await execute(
      'INSERT INTO events (code, name, event_date, status) VALUES (?, ?, ?, ?)',
      [code, name, event_date ?? null, status ?? 'planning']
    );
    const id = Number(result.lastInsertRowid);
    const created = await getOne('SELECT * FROM events WHERE id = ?', [id]);
    return NextResponse.json({ event: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create event' }, { status: 500 });
  }
}
