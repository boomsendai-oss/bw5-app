import { NextRequest, NextResponse } from 'next/server';
import { verifyPassword } from '@/lib/eventAuth';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const success = !!password && (await verifyPassword(password));
    return NextResponse.json({ success });
  } catch {
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
