import { NextRequest, NextResponse } from 'next/server';
import { execute, getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/master/studios
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const rows = await getAll(`SELECT * FROM studios ORDER BY active DESC, name ASC`);
  return NextResponse.json({ studios: rows });
}

// POST /api/staff/master/studios — 新規作成
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });
  const result = await execute(
    `INSERT INTO studios (name, address, google_map_url, pricing_model, hourly_rate, block_pricing, daily_buffer_minutes, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      body.name,
      body.address ?? null,
      body.google_map_url ?? null,
      body.pricing_model ?? 'hourly',
      body.hourly_rate ?? 0,
      body.block_pricing ? JSON.stringify(body.block_pricing) : null,
      body.daily_buffer_minutes ?? 0,
      body.notes ?? null,
    ]
  );
  return NextResponse.json({ ok: true, id: Number(result.lastInsertRowid) });
}
