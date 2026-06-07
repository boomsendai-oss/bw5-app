import { NextResponse, type NextRequest } from 'next/server';

/**
 * 認証プロキシ (Next.js 16: middleware → proxy)
 *
 * edge runtime のため DB アクセス不可。
 * cookie の存在チェックのみ行い、実際の認証は API 層 (eventAuth.ts) に委譲。
 * header x-admin-password がある場合も通過させ、API 層で bcrypt 検証する。
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === '/staff/events/login' || pathname === '/api/staff/events/login') return NextResponse.next();

  const cookie = req.cookies.get('staff_events_auth')?.value;
  if (cookie) return NextResponse.next();

  const header = req.headers.get('x-admin-password');
  if (header) return NextResponse.next();

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
