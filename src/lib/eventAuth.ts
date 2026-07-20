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

// ============================================
// PR-5: 認可ラッパ + レート制限
// ============================================

type Handler = (req: NextRequest, ctx?: unknown) => Promise<Response>;

/**
 * route handler を認可必須にするラッパ。
 *
 * 各routeの冒頭で `if (!(await isAuthorized(req))) return unauthorized();` を
 * 書き忘れると認証が丸ごと抜ける(監査C系の再発経路)ため、新規routeはこれで包む。
 *
 *   export const GET = withAuth(async (req) => { ... });
 *
 * ※公開APIは包まない代わりに「公開である理由」をコメントで明記する(CLAUDE.md規約)。
 */
export function withAuth(handler: Handler): Handler {
  return async (req: NextRequest, ctx?: unknown) => {
    if (!(await isAuthorized(req))) return unauthorized();
    return handler(req, ctx);
  };
}

/**
 * 固定窓レート制限。`key` 単位で `windowSec` 秒あたり `max` 回まで true を返す。
 * 上限を超えたら false(呼び出し側で429を返す)。
 *
 * rate_limits テーブルは台帳マイグレーション(20260720_rate_limits.sql)で作成。
 * DBが未作成/一時的に落ちている場合は **通す**(fail-open)。理由: これはPINリセット等の
 * 補助的な濫用防止であり、DB不調で正規ユーザーの操作まで止める方が損害が大きい。
 * 認可(isAuthorized)は従来どおりfail-closedなので、ここが開いても権限は破られない。
 */
export async function checkRateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (nowSec % windowSec);
    const row = await getOne(
      'SELECT count FROM rate_limits WHERE key = ? AND window_start = ?',
      [key, String(windowStart)]
    );
    if (!row) {
      // 同一キーの古い窓を掃除しつつ現在の窓を作る
      await execute(
        `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
        [key, String(windowStart)]
      );
      return true;
    }
    const count = Number(row.count ?? 0);
    if (count >= max) return false;
    await execute(
      'UPDATE rate_limits SET count = count + 1 WHERE key = ? AND window_start = ?',
      [key, String(windowStart)]
    );
    return true;
  } catch {
    return true;
  }
}

/** レート制限のキーに使う発信元IP。プロキシ経由のためヘッダから取る。 */
export function clientIp(req: NextRequest): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export function tooManyRequests(): NextResponse {
  return NextResponse.json(
    { error: 'Too Many Requests', message: 'リクエストが多すぎます。しばらく時間をおいて再度お試しください。' },
    { status: 429 }
  );
}
