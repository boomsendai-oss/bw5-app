'use server';

// ⚠️ 公開Server Action(認証なし)。理由: 公式LINE の『発表会』ボタンからURLを送り直すため。答えはいつも同じ文（申込があるかは出さない）。
// IP とメールの両方で回数を数える。メールの回数のキーは、そろえたメールの sha256 先頭16けた（13 の申込フォームと同じキー。生のメールを入れない）。
// eventKey は checkPublicEventKey で確かめる（試しの発表会は鍵が合う時だけ）。宛先・世帯の番号・送った数は返さない。
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { RECITAL_RATE, normalizeEmail } from '@/lib/recital';
import { resendMyPageUrl } from '@/lib/recitalFamilyDb';
import { RECITAL_MSG } from '@/lib/recitalPublic';
import { checkPublicEventKey } from '../context';

const DONE = 'お申し込みがあれば、マイページのURLを送りました';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;

async function ip(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export async function resendUrlAction(eventKey: string, pv: string | null, email: string): Promise<{ message: string }> {
  if (typeof eventKey !== 'string' || !(await checkPublicEventKey(eventKey, typeof pv === 'string' ? pv : null))) {
    return { message: DONE };
  }
  if (!(await checkRateLimit(`bw6:resend:${await ip()}`, ...RECITAL_RATE.resendIp))) return { message: RECITAL_MSG.rate };
  const norm = normalizeEmail(typeof email === 'string' ? email : '');
  // 形の合わないメールも同じ文（形で申込の有無が分からないように）
  if (norm === '' || norm.length > EMAIL_MAX || !EMAIL_RE.test(norm)) return { message: DONE };
  const key = createHash('sha256').update(norm).digest('hex').slice(0, 16);
  if (!(await checkRateLimit(`bw6:resend-to:${key}`, ...RECITAL_RATE.resendEmail))) return { message: RECITAL_MSG.rate };
  try {
    await resendMyPageUrl(eventKey, { email: norm });
  } catch (e) {
    console.error('[recital] URLの送り直しに失敗しました', e instanceof Error ? e.message : String(e));
  }
  return { message: DONE };
}
