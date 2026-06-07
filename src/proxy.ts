import { NextResponse, type NextRequest } from 'next/server';

/**
 * 認証プロキシ (Next.js 16: middleware → proxy)
 *
 * 対象:
 *  - /staff/** 全体（ページ）
 *  - /api/staff/** /api/settings /api/upload（API）
 *
 * 認可: cookie staff_events_auth または header x-admin-password が
 *        ADMIN_PASSWORD と一致すれば通過。
 *
 * edge runtime のため process.env は build 時に inline される。
 * DB フォールバックは API 層 (eventAuth.ts) で行う。
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/staff/events/login') return NextResponse.next();

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return NextResponse.next();

  const cookie = req.cookies.get('staff_events_auth')?.value;
  if (cookie === expected) return NextResponse.next();

  const header = req.headers.get('x-admin-password');
  if (header === expected) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = '/staff/events/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    '/staff/:path*',
    '/api/staff/:path*',
    '/api/settings',
    '/api/upload',
  ],
};
