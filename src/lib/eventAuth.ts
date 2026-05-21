import { NextRequest, NextResponse } from 'next/server';
import { getOne } from './db';

/**
 * イベント運営アプリ用の軽量認証。
 * 既存 ADMIN_PASSWORD (Vercel env) を使う。フォールバックで settings.admin_password も参照。
 *
 * クライアントは以下のいずれかで認証情報を渡す:
 *  - Header: x-admin-password
 *  - Cookie: staff_events_auth (middleware が同様に検証)
 */

export const EVENTS_AUTH_COOKIE = 'staff_events_auth';

export async function resolveAdminPassword(): Promise<string> {
  let pw = process.env.ADMIN_PASSWORD ?? '';
  if (!pw) {
    const row = await getOne("SELECT value FROM settings WHERE key = 'admin_password'");
    pw = (row?.value as string | undefined) ?? '';
  }
  return pw;
}

export async function isAuthorized(req: NextRequest): Promise<boolean> {
  const expected = await resolveAdminPassword();
  if (!expected) return false;
  const header = req.headers.get('x-admin-password');
  if (header && header === expected) return true;
  const cookie = req.cookies.get(EVENTS_AUTH_COOKIE)?.value;
  if (cookie && cookie === expected) return true;
  return false;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
