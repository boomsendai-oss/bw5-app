import { NextRequest, NextResponse } from 'next/server';
import { EVENTS_AUTH_COOKIE, verifyPassword, createSession } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const success = !!password && (await verifyPassword(password));
    if (!success) {
      return NextResponse.json({ success: false });
    }
    // /admin ログインでも本物のセッションCookieを発行する。
    // これがないと /admin 配下ページの fetch (video-orders / merchandise 等) が
    // isAuthorized を通れず、認可を追加した瞬間に管理画面が空になる。
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
    return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
  }
}
