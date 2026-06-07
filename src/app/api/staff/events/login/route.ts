import { NextRequest, NextResponse } from 'next/server';
import { EVENTS_AUTH_COOKIE, verifyPassword, createSession, deleteSession } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!password || !(await verifyPassword(password))) {
      return NextResponse.json({ success: false }, { status: 401 });
    }
    const token = await createSession();
    const res = NextResponse.json({ success: true });
    res.cookies.set(EVENTS_AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return res;
  } catch {
    return NextResponse.json({ success: false }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(EVENTS_AUTH_COOKIE)?.value;
  if (token) await deleteSession(token);
  const res = NextResponse.json({ success: true });
  res.cookies.delete(EVENTS_AUTH_COOKIE);
  return res;
}
