import { NextRequest, NextResponse } from 'next/server';
import { INSTRUCTOR_SESSION_COOKIE, deleteSession } from '@/lib/instructorAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const token = req.cookies.get(INSTRUCTOR_SESSION_COOKIE)?.value;
  if (token) await deleteSession(token);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(INSTRUCTOR_SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
