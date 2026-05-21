import { NextRequest, NextResponse } from 'next/server';
import { EVENTS_AUTH_COOKIE, resolveAdminPassword } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

// POST /api/staff/events/login — password を受け取り、Cookie をセットして返す
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const expected = await resolveAdminPassword();
    if (!expected || password !== expected) {
      return NextResponse.json({ success: false }, { status: 401 });
    }
    const res = NextResponse.json({ success: true });
    res.cookies.set(EVENTS_AUTH_COOKIE, expected, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}

// DELETE — logout
export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(EVENTS_AUTH_COOKIE);
  return res;
}
