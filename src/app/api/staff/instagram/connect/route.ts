import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildConsentUrl } from '@/lib/instagram';
import { OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/instagram/connect
// Instagram(Facebook Login for Business)連携の同意画面へリダイレクトする。
// 認証: 管理パスワード
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const origin = new URL(req.url).origin;
  try {
    // M20(横展開): CSRF対策のstateを発行してcookieとURL両方に載せる
    const state = randomUUID();
    const url = buildConsentUrl(origin, state);
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600,
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
