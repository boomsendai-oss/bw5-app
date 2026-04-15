import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { password } = body;

    const setting = await getOne("SELECT value FROM settings WHERE key = 'admin_password'");
    const adminPassword = setting?.value ?? '';

    const success = password === adminPassword;
    return NextResponse.json({ success });
  } catch (error) {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
