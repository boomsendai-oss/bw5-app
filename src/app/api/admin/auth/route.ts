import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;

    // Source of truth: ADMIN_PASSWORD env var (Vercel encrypted).
    // Fallback to legacy DB row only for local dev where the env var
    // may not be set.
    let adminPassword = process.env.ADMIN_PASSWORD ?? '';
    if (!adminPassword) {
      const setting = await getOne("SELECT value FROM settings WHERE key = 'admin_password'");
      adminPassword = (setting?.value as string | undefined) ?? '';
    }

    const success = !!adminPassword && password === adminPassword;
    return NextResponse.json({ success });
  } catch {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
