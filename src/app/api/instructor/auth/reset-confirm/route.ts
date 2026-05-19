import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { INSTRUCTOR_SESSION_COOKIE, createSession, hashPin } from '@/lib/instructorAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/instructor/auth/reset-confirm
// body: { token, new_pin }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token ?? '');
  const newPin = String(body.new_pin ?? '');
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });
  if (!/^\d{4,6}$/.test(newPin)) return NextResponse.json({ error: 'PIN は4〜6桁の数字' }, { status: 400 });

  const reset = await getOne(`SELECT * FROM instructor_pin_resets WHERE reset_token = ?`, [token]);
  if (!reset) return NextResponse.json({ error: 'リセットトークンが無効です' }, { status: 400 });
  if (reset.used_at) return NextResponse.json({ error: 'このトークンは使用済みです' }, { status: 400 });
  const expires = new Date(reset.expires_at as string);
  if (expires < new Date()) return NextResponse.json({ error: 'トークンが期限切れです (1時間)' }, { status: 400 });

  const hash = hashPin(newPin);
  await execute(`UPDATE instructors SET pin_hash = ?, pin_set_at = CURRENT_TIMESTAMP WHERE id = ?`, [hash, reset.instructor_id]);
  await execute(`UPDATE instructor_pin_resets SET used_at = CURRENT_TIMESTAMP WHERE id = ?`, [reset.id]);

  const sessionToken = await createSession(reset.instructor_id as number);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(INSTRUCTOR_SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
