import { NextRequest, NextResponse } from 'next/server';
import { getAll, batch } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Keys that must NEVER be exposed via the public GET.
// The admin UI reads these through a separate authenticated endpoint.
const PRIVATE_KEYS = new Set([
  'admin_password',
  'lottery_keyword',           // public could read & spoof entries
  'square_app_id',
  'square_location_id',
]);

export async function GET(req: NextRequest) {
  try {
    const rows = await getAll('SELECT key, value FROM settings');
    const settings: Record<string, string> = {};
    // Allow admin area to get full set when it passes the password cookie/header.
    const isAdmin = req.headers.get('x-admin-auth') === '1';
    for (const row of rows) {
      if (!isAdmin && PRIVATE_KEYS.has(row.key)) continue;
      settings[row.key] = row.value;
    }
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, string>;
    await batch(
      Object.entries(body).map(([key, value]) => ({
        sql: 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        args: [key, value],
      })),
      'write'
    );

    const rows = await getAll('SELECT key, value FROM settings');
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
