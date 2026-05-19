import { NextRequest, NextResponse } from 'next/server';
import { getOne } from '@/lib/db';
import { INSTRUCTOR_SESSION_COOKIE, createSession, verifyPin } from '@/lib/instructorAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/instructor/auth/login
// body: { instructor_id, pin?, birth_date? }
//
// - PINが設定済み → pin で認証
// - PIN未設定 → birth_date(YYYYMMDD) で認証 (初回ログイン)
//
// 成功時: setupRequired=true なら setup-pin に誘導
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const instructorId = Number(body.instructor_id);
  if (!instructorId) return NextResponse.json({ error: 'instructor_id required' }, { status: 400 });

  const ins = await getOne(`SELECT id, name, pin_hash, birth_date FROM instructors WHERE id = ? AND active = 1`, [instructorId]);
  if (!ins) return NextResponse.json({ error: 'instructor not found' }, { status: 404 });

  const pinHash = ins.pin_hash as string | null;
  let setupRequired = false;

  if (pinHash) {
    // PINで認証
    if (!body.pin) return NextResponse.json({ error: 'pin required' }, { status: 400 });
    if (!verifyPin(String(body.pin), pinHash)) {
      return NextResponse.json({ error: 'PIN が正しくありません' }, { status: 401 });
    }
  } else {
    // 初回ログイン: birth_dateで認証
    if (!body.birth_date) return NextResponse.json({ error: '初回ログインは生年月日(YYYYMMDD)が必要です', need_birth_date: true }, { status: 400 });
    const stored = (ins.birth_date as string | null) ?? '';
    const input = String(body.birth_date).replace(/[-\/\s]/g, '');
    const storedNormalized = stored.replace(/[-\/]/g, '');
    if (!storedNormalized) {
      return NextResponse.json({ error: '生年月日がマスタに未登録です。TAROに連絡してください', need_setup_master: true }, { status: 400 });
    }
    if (storedNormalized !== input) {
      return NextResponse.json({ error: '生年月日が正しくありません' }, { status: 401 });
    }
    setupRequired = true;
  }

  const token = await createSession(
    Number(ins.id),
    req.headers.get('user-agent') ?? undefined,
    req.headers.get('x-forwarded-for') ?? undefined
  );

  const res = NextResponse.json({ ok: true, instructor: { id: ins.id, name: ins.name }, setup_required: setupRequired });
  res.cookies.set(INSTRUCTOR_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 30 * 24 * 3600,
  });
  return res;
}
