import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { NextRequest } from 'next/server';
import { execute, getOne } from './db';

export const INSTRUCTOR_SESSION_COOKIE = 'instructor_session';
const SESSION_TTL_HOURS = 24 * 30;

export function hashPin(pin: string, salt?: string): string {
  const s = salt ?? randomBytes(8).toString('hex');
  const key = scryptSync(pin, s, 32);
  return `${s}:${key.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  if (!stored) return false;
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const test = scryptSync(pin, salt, 32);
  const stored_buf = Buffer.from(key, 'hex');
  if (test.length !== stored_buf.length) return false;
  return timingSafeEqual(test, stored_buf);
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('hex');
}

export async function createSession(instructorId: number, userAgent?: string, ipAddress?: string): Promise<string> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000).toISOString();
  await execute(
    `INSERT INTO instructor_sessions (instructor_id, session_token, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [instructorId, token, expiresAt, userAgent ?? null, ipAddress ?? null]
  );
  return token;
}

export async function getInstructorBySession(req: NextRequest): Promise<{ id: number; name: string; salary_type: string; payslip_folder_url: string | null; contact_email: string | null } | null> {
  const token = req.cookies.get(INSTRUCTOR_SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await getOne(
    `SELECT s.instructor_id, s.expires_at, i.name, i.salary_type, i.payslip_folder_url, i.contact_email
     FROM instructor_sessions s
     LEFT JOIN instructors i ON i.id = s.instructor_id
     WHERE s.session_token = ?`,
    [token]
  );
  if (!session) return null;
  const expiresAt = new Date(session.expires_at as string);
  if (expiresAt < new Date()) return null;
  return {
    id: session.instructor_id as number,
    name: session.name as string,
    salary_type: (session.salary_type as string) ?? 'per_lesson',
    payslip_folder_url: session.payslip_folder_url as string | null,
    contact_email: session.contact_email as string | null,
  };
}

export async function deleteSession(token: string): Promise<void> {
  await execute(`DELETE FROM instructor_sessions WHERE session_token = ?`, [token]);
}
