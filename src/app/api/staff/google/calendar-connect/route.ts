import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildConsentUrl, OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/google/calendar-connect
// Googleカレンダー(書き込み)連携の同意画面へリダイレクトする。
// 認証: 管理パスワード
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const origin = new URL(req.url).origin;
  try {
    // M20: CSRF対策。ランダムなstateを発行し、httpOnly cookieとGoogleへのURL両方に載せる。
    // コールバック側で一致を検証し、不一致なら400(=他人が取得したcodeを踏ませる攻撃を防ぐ)。
    const state = randomUUID();
    const url = buildConsentUrl(origin, state);
    const res = NextResponse.redirect(url);
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 600, // 同意フローは10分あれば十分
    });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
