import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildConsentUrl } from '@/lib/tiktok';
import { OAUTH_STATE_COOKIE } from '@/lib/googleCalendar';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/tiktok/connect
// TikTok連携の同意画面へリダイレクトする(instagram/threads の connect と同型)。
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const origin = new URL(req.url).origin;
  try {
    const state = randomUUID();
    const res = NextResponse.redirect(buildConsentUrl(origin, state));
    res.cookies.set(OAUTH_STATE_COOKIE, state, {
      httpOnly: true, sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 600,
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
