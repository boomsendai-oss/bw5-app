'use server';

// ⚠️ 公開Server Action(認証なし)。理由: ログイン自体のため。
// 総当たりはレート制限で抑える。
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { CREW_COOKIE, CREW_SESSION_DAYS, isValidPinFormat, normalizePin } from '@/lib/bf6Crew';
import { createCrewSession, verifyCrewPin } from '@/lib/bf6CrewDb';
import { checkRateLimit } from '@/lib/eventAuth';

export async function crewLogin(
  _prev: { error: string } | null,
  form: FormData
): Promise<{ error: string }> {
  const h = await headers();
  const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  if (!(await checkRateLimit(`bf6crew:${ip}`, 20, 600))) {
    return { error: '試行が多すぎます。少し時間をおいてください' };
  }

  const pin = normalizePin(String(form.get('pin') ?? ''));
  if (!isValidPinFormat(pin)) return { error: 'PINは4〜8桁の数字です' };
  if (!(await verifyCrewPin(pin))) return { error: 'PINが違います' };

  const token = await createCrewSession();
  const store = await cookies();
  store.set(CREW_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: true,
    path: '/',
    maxAge: CREW_SESSION_DAYS * 24 * 60 * 60,
  });

  const next = String(form.get('next') ?? '');
  redirect(next.startsWith('/bf6/crew') ? next : '/bf6/crew');
}
