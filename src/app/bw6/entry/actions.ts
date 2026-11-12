'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BW6 の出演申込は公開フォームから受けるため。申込を列挙する道は作らない。
// 同じメール・同じ電話の時も相手の中身は返さない。金額はサーバで計算し直す。
// eventKey は checkPublicEventKey で確かめる（試しの発表会は鍵が合う時だけ）。
// 連打よけは IP（x-forwarded-for の先頭）ごと。URL のメールの送り直しは、そろえたメール・電話の sha256 先頭16けたごとにも数える
// （rate のキーに生のメール・電話を入れない）。受付の状態・中身・同じメール・控えのメール・照合は submitEntry（7）の中でやる。
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { RECITAL_RATE, normalizeEmail, normalizePhone } from '@/lib/recital';
import { precheckEntry, submitEntry, type EntrySubmission, type SubmitResult } from '@/lib/recitalEntryDb';
import { quoteEntry, resendMyPageUrl, type QuotePerson } from '@/lib/recitalFamilyDb';
import type { ChargeLine } from '@/lib/recitalFee';
import { RECITAL_MSG } from '@/lib/recitalPublic';
import { checkPublicEventKey } from '../context';

export type EntryActionResult = SubmitResult | { ok: false; code: 'rate'; message: string };

const INVALID_PAGE = 'このページからは送れません。';
const MAX_PEOPLE = 10;

async function ip(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 同じメール・同じ電話の世帯へ URL を送り直す。そろえた値ごとの上限を超えていたら送らない（表示は変えない） */
async function resendLimited(eventKey: string, by: { email: string } | { phone: string }): Promise<void> {
  const norm = 'email' in by ? normalizeEmail(by.email) : normalizePhone(by.phone);
  if (norm === '') return;
  const h = createHash('sha256').update(norm).digest('hex').slice(0, 16);
  try {
    if (!(await checkRateLimit(`bw6:resend-to:${h}`, ...RECITAL_RATE.resendEmail))) return;
    await resendMyPageUrl(eventKey, by);
  } catch (e) {
    console.error('[recital] URLの送り直しに失敗しました', e instanceof Error ? e.message : String(e));
  }
}

/** 画面1（phone ''・people []）と画面6 の「送る」の前の確かめ。書かない。相手の中身は返さない */
export async function precheckEntryAction(
  eventKey: string,
  pv: string | null,
  x: { email: string; phone: string; people: { lastKana: string; firstKana: string; birthday: string }[] },
): Promise<{ ok: true; sameEmail: boolean; samePhone: boolean; samePersonIdx: number[] } | { ok: false; code: 'rate' | 'invalid'; message: string }> {
  if (typeof eventKey !== 'string' || !(await checkPublicEventKey(eventKey, typeof pv === 'string' ? pv : null))) {
    return { ok: false, code: 'invalid', message: INVALID_PAGE };
  }
  if (!(await checkRateLimit(`bw6:precheck:${await ip()}`, ...RECITAL_RATE.precheck))) {
    return { ok: false, code: 'rate', message: RECITAL_MSG.rate };
  }
  const email = str(x?.email);
  const phone = str(x?.phone);
  const people = (Array.isArray(x?.people) ? x.people : []).slice(0, MAX_PEOPLE).map((p) => ({
    lastKana: str(p?.lastKana), firstKana: str(p?.firstKana), birthday: str(p?.birthday),
  }));
  const r = await precheckEntry(eventKey, { email, phone, people });
  if (r.sameEmail) await resendLimited(eventKey, { email });
  if (r.samePhone) await resendLimited(eventKey, { phone });
  return { ok: true, sameEmail: r.sameEmail, samePhone: r.samePhone, samePersonIdx: r.samePersonIdx };
}

/** 画面3・5 の金額。書かない。連打よけは付けない（R-33：金額の計算には付けない） */
export async function quoteEntryAction(
  eventKey: string,
  pv: string | null,
  people: QuotePerson[],
): Promise<{ ok: true; lines: ChargeLine[]; total: number; totalIfAllIn: number } | { ok: false; code: 'invalid'; message: string }> {
  if (typeof eventKey !== 'string' || !(await checkPublicEventKey(eventKey, typeof pv === 'string' ? pv : null))) {
    return { ok: false, code: 'invalid', message: INVALID_PAGE };
  }
  const clean: QuotePerson[] = (Array.isArray(people) ? people : []).slice(0, MAX_PEOPLE).map((p) => ({
    lastName: str(p?.lastName), firstName: str(p?.firstName), lastKana: str(p?.lastKana), firstKana: str(p?.firstKana),
    birthday: str(p?.birthday) || null,
    works: (Array.isArray(p?.works) ? p.works : [])
      .filter((c) => Number.isInteger(c?.workId) && (c?.status === 'in' || c?.status === 'maybe'))
      .map((c) => ({ workId: c.workId, status: c.status })),
  }));
  const q = await quoteEntry(eventKey, clean);
  return { ok: true, ...q };
}

/** 「送る」。受付の状態・中身・同じメール・控えのメール・照合は submitEntry の中（ここで重ねてやらない） */
export async function submitEntryAction(s: EntrySubmission, pv: string | null): Promise<EntryActionResult> {
  if (!s || typeof s.eventKey !== 'string' || !(await checkPublicEventKey(s.eventKey, typeof pv === 'string' ? pv : null))) {
    return { ok: false, code: 'invalid', message: INVALID_PAGE };
  }
  if (!(await checkRateLimit(`bw6:submit:${await ip()}`, ...RECITAL_RATE.submit))) {
    return { ok: false, code: 'rate', message: RECITAL_MSG.rate };
  }
  return submitEntry(s);
}
