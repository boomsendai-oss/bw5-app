import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAll, batch } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const rows = await getAll('SELECT key, value FROM settings');
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return NextResponse.json(settings);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  try {
    const body = await req.json() as Record<string, string>;
    if (body.admin_password) {
      body.admin_password = await bcrypt.hash(body.admin_password, 10);
    }
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
