import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { buildConsentUrl } from '@/lib/googleCalendar';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/google/calendar-connect
// Googleカレンダー(書き込み)連携の同意画面へリダイレクトする。
// 認証: 管理パスワード
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const origin = new URL(req.url).origin;
  try {
    const url = buildConsentUrl(origin);
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
