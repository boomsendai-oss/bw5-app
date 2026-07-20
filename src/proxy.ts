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

/**
 * 認可が必要な経路。
 *
 * ⚠️ 反転(「原則すべて認証・例外だけ公開」)は採らない。
 * `/api/vote` `/api/photo` `/api/video-preorder` 等の**公開API**が実在し、
 * 反転すると即座に顧客側の障害になるため。代わりに以下の運用で守る:
 *   1. スタッフ専用の非/staff経路はここに列挙する(M24で /admin・/api/admin を追加)
 *   2. 新規 route.ts は `withAuth` で包むか、「公開である理由」をコメントで書く(M27・CLAUDE.md規約)
 */
export const config = {
  matcher: [
    '/staff/:path*',
    '/api/staff/:path*',
    '/api/settings',
    '/api/upload',
    // M24: BW5管理画面。旧実装は sessionStorage フラグだけで実質ノーガードだった
    '/admin',
    '/admin/:path*',
    '/api/admin/:path*',
  ],
};
