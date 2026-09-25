'use server';

// BF7 ウェイトリストの登録(Server Action・規約6)。
// ⚠️ 公開ページから呼ばれる。連投対策に既存のレート制限を通す。
import { validateBf7Notify, buildBf7NotifyEmail, type Bf7NotifyInput } from '@/lib/bf7';
import { addBf7Notify } from '@/lib/bf7Db';
import { checkRateLimit } from '@/lib/eventAuth';
import { headers } from 'next/headers';
import { sendEmail } from '@/lib/email';

/** 連投対策のキー。BF6のactions.tsと同じ取り方に合わせる。 */
async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
}

export async function submitBf7Notify(
  input: Bf7NotifyInput
): Promise<{ ok: true; already: boolean } | { ok: false; error: string }> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf7:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const v = validateBf7Notify(input);
  if (typeof v === 'string') return { ok: false, error: v };
  const saved = await addBf7Notify(v);
  try {
    const mail = buildBf7NotifyEmail(v);
    await sendEmail({ to: v.email, subject: mail.subject, text: mail.text });
  } catch (e) {
    // メールが出せなくても登録は成立させる(名簿に残す方が大事)
    console.error('[bf7] notify email failed', v.email, e instanceof Error ? e.message : e);
  }
  return { ok: true, already: saved.already };
}
