// BF6当日オペ用クルー認証のDB層。計算は bf6Crew.ts、ここは永続化だけ。
import { getOne, execute } from './db';
import { nowUtcIso } from './dateJst';
import { CREW_COOKIE, crewSessionExpiry, normalizePin } from './bf6Crew';

const PIN_KEY = 'crew_pin';

/** 設定済みのPIN。未設定なら空文字(=誰も入れない)。 */
export async function getCrewPin(): Promise<string> {
  const row = await getOne('SELECT value FROM bf_settings WHERE key = ?', [PIN_KEY]).catch(() => null);
  return row?.value ? String(row.value) : '';
}

export async function setCrewPin(pin: string): Promise<void> {
  await execute(
    `INSERT INTO bf_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [PIN_KEY, pin, nowUtcIso()]
  );
}

/**
 * PINを照合する。
 * ⚠️ PINが未設定のときは必ず false。空文字入力で素通りする事故を防ぐ。
 */
export async function verifyCrewPin(input: string): Promise<boolean> {
  const stored = await getCrewPin();
  if (!stored) return false;
  return normalizePin(input) === normalizePin(stored);
}

export async function createCrewSession(): Promise<string> {
  const token = crypto.randomUUID();
  await execute(
    'INSERT INTO bf_crew_sessions (token, expires_at, created_at) VALUES (?, ?, ?)',
    [token, crewSessionExpiry(new Date()), nowUtcIso()]
  );
  return token;
}

export async function verifyCrewSession(token: string): Promise<boolean> {
  if (!token) return false;
  const row = await getOne(
    "SELECT token FROM bf_crew_sessions WHERE token = ? AND expires_at > datetime('now')",
    [token]
  ).catch(() => null);
  return !!row;
}

export async function deleteCrewSession(token: string): Promise<void> {
  await execute('DELETE FROM bf_crew_sessions WHERE token = ?', [token]).catch(() => {});
}

/**
 * Server Component / Server Action 用の入場判定。
 * クルーPINのセッション、または本部(/staff)のセッションがあれば通す
 * (TAROは普段の管理ログインのままクルー画面も開けたほうが取り回しがよい)。
 */
export async function isCrewAuthorized(): Promise<boolean> {
  const { cookies } = await import('next/headers');
  const store = await cookies();
  if (await verifyCrewSession(store.get(CREW_COOKIE)?.value ?? '')) return true;
  const { isAuthorizedServer } = await import('./eventAuth');
  return isAuthorizedServer();
}
