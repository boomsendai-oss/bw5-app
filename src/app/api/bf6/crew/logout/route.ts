// ⚠️ 公開API(認証なし)。理由: ログアウトのため。自分のcookieを捨てるだけで、
// 他人のセッションには触れない。
import { NextRequest, NextResponse } from 'next/server';
import { CREW_COOKIE } from '@/lib/bf6Crew';
import { deleteCrewSession } from '@/lib/bf6CrewDb';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(CREW_COOKIE)?.value;
  if (token) await deleteCrewSession(token);
  const res = NextResponse.redirect(new URL('/bf6/crew/login', req.url), 303);
  res.cookies.set(CREW_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
