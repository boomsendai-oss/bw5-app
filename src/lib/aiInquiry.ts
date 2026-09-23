// /ai ページ（boom-sendai.com/ai）の相談フォームの検証とメール本文。純関数のみ（DB・送信は route 側）。
export type Inquiry = { name: string; business: string; contact: string; message: string };
export type ValidateResult = { ok: true; data: Inquiry } | { ok: false; error: string };

const LIMITS = { name: 100, business: 200, contact: 200, message: 2000 } as const;

const str = (v: unknown, max: number): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';

export function validateInquiry(input: unknown): ValidateResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid' };
  const o = input as Record<string, unknown>;
  // ハニーポット: 人間には見えない website 欄に値が入っていればボット
  if (typeof o.website === 'string' && o.website.trim()) return { ok: false, error: 'spam' };
  const data: Inquiry = {
    name: str(o.name, LIMITS.name),
    business: str(o.business, LIMITS.business),
    contact: str(o.contact, LIMITS.contact),
    message: str(o.message, LIMITS.message),
  };
  for (const k of Object.keys(data) as (keyof Inquiry)[]) {
    if (!data[k]) return { ok: false, error: `missing:${k}` };
  }
  return { ok: true, data };
}

export function buildInquiryMail(d: Inquiry, ip: string): { subject: string; text: string } {
  const now = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return {
    subject: `【AI相談】${d.name}`,
    text: [
      `boom-sendai.com/ai の相談フォームから届きました（${now} JST）`,
      '',
      `お名前: ${d.name}`,
      `事業・職種: ${d.business}`,
      `連絡先: ${d.contact}`,
      '',
      '困っていること:',
      d.message,
      '',
      '--',
      `送信元IP: ${ip}`,
    ].join('\n'),
  };
}
