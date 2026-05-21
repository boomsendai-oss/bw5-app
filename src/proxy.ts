import { NextResponse, type NextRequest } from 'next/server';

/**
 * 認証プロキシ (Next.js 16: middleware → proxy) — `/staff/events/*` 配下のみ対象。
 * 既存 `/staff/backstage`, `/staff/orders` は対象外で、従来どおりページ側パスワードprompt が機能する。
 *
 * 認可: cookie `staff_events_auth` が ADMIN_PASSWORD と一致すれば通過。
 * 未認証時は `/staff/events/login?next=...` へリダイレクト。
 *
 * 注意: edge runtime のため process.env は build 時に inline される。
 * DB フォールバックは API 層で行う (ここでは env のみ参照)。
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ログインページ自体は通過させる
  if (pathname === '/staff/events/login') return NextResponse.next();

  const expected = process.env.ADMIN_PASSWORD;
  // 環境変数が無い (ローカル等) では middleware では弾かず、API側で検証する方針
  if (!expected) return NextResponse.next();

  const cookie = req.cookies.get('staff_events_auth')?.value;
  if (cookie === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/staff/events/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

// IMPORTANT: matcher は /staff/events/:path* に限定。
// 既存お客さん向け (`/`, `/photo`, `/merch`, `/timetable`, `/shop`, `/api/*`)
// および既存 `/staff/backstage`, `/staff/orders` には影響しない。
export const config = {
  matcher: ['/staff/events/:path*'],
};
