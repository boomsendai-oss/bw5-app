import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getOne, execute } from './db';

export const EVENTS_AUTH_COOKIE = 'staff_events_auth';
const SESSION_MAX_AGE_DAYS = 30;

export async function resolveAdminPasswordHash(): Promise<string> {
  let pw = process.env.ADMIN_PASSWORD ?? '';
  if (!pw) {
    const row = await getOne("SELECT value FROM settings WHERE key = 'admin_password'");
    pw = (row?.value as string | undefined) ?? '';
  }
  return pw;
}

async function verifyPassword(plain: string): Promise<boolean> {
  const stored = await resolveAdminPasswordHash();
  if (!stored) return false;
  if (stored.startsWith('$2')) {
    return bcrypt.compare(plain, stored);
  }
  return plain === stored;
}

async function verifySessionToken(token: string): Promise<boolean> {
  const row = await getOne(
    "SELECT id FROM admin_sessions WHERE token = ? AND expires_at > datetime('now')",
    [token]
  );
  return !!row;
}

export async function createSession(): Promise<string> {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  await execute(
    'INSERT INTO admin_sessions (token, expires_at) VALUES (?, ?)',
    [token, expiresAt]
  );
  return token;
}

export async function deleteSession(token: string): Promise<void> {
  await execute('DELETE FROM admin_sessions WHERE token = ?', [token]);
}

export async function isAuthorized(req: NextRequest): Promise<boolean> {
  const cookie = req.cookies.get(EVENTS_AUTH_COOKIE)?.value;
  if (cookie) {
    if (await verifySessionToken(cookie)) return true;
  }
  const header = req.headers.get('x-admin-password');
  if (header) {
    if (await verifyPassword(header)) return true;
  }
  return false;
}

export { verifyPassword };

// Server Component / Server Action 用 (NextRequest が無い文脈)。
// 既存のセッションcookie検証をそのまま流用する。
export async function isAuthorizedServer(): Promise<boolean> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  const token = store.get(EVENTS_AUTH_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
