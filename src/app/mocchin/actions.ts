'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BW6スペシャルナンバー by MOCCHIN の申込は
// BOOM会員以外(県外の方も)申し込めるため、/mocchin の公開フォームが叩く。
// PII対策: 申込を読み出す公開経路は作らない(送信のみ)。送信はIP単位のレート制限。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { sendEmail } from '@/lib/email';
import { isXmasPreview } from '@/lib/partyPreview';
import {
  buildMocchinEmail,
  formatMocchinNo,
  mocchinGate,
  mocchinGateError,
  mocchinPayDeadline,
  mocchinTransferPrefix,
  validateMocchinInput,
  type FieldErrors,
  type MocchinInput,
} from '@/lib/mocchinEntry';
import { MOCCHIN_SETTINGS_KEY, countActiveMocchin, createMocchinEntry, getMocchinCapacity, setMocchinStaffNote } from '@/lib/mocchinEntryDb';

export type MocchinSubmitResult =
  | { ok: true; no: string; transferPrefix: string; payDeadline: string; isMember: boolean; overCapacity: boolean; mailed: boolean }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

async function ip(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export async function submitMocchinEntry(input: MocchinInput, preview?: string): Promise<MocchinSubmitResult> {
  if (!(await checkRateLimit(`mocchin:${await ip()}`, 10, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const v = validateMocchinInput(input);
  if (!v.ok) return { ok: false, error: '入力内容を確認してください', fieldErrors: v.errors };

  // プレビュー鍵つき(スタッフの事前確認)のときだけ、受付期間の外でも送れる。保存した行には印を付ける
  const isPreview = isXmasPreview(MOCCHIN_SETTINGS_KEY, preview);
  if (!isPreview) {
    const gateErr = mocchinGateError(mocchinGate(todayJst()), v.value.isMember);
    if (gateErr) return { ok: false, error: gateErr };
  }

  const before = await countActiveMocchin();
  const capacity = await getMocchinCapacity();
  const { id, appliedOn } = await createMocchinEntry(v.value);
  if (isPreview) await setMocchinStaffNote(id, 'プレビューから送信(テスト)');
  const overCapacity = before + 1 > capacity;

  let mailed = true;
  try {
    const mail = buildMocchinEmail({ id, name: v.value.name, appliedOn, isMember: v.value.isMember, overCapacity });
    await sendEmail({ to: v.value.email, subject: mail.subject, text: mail.text });
  } catch (e) {
    // メールが送れなくても申込は保存済み。完了画面に振込先を出すので、その旨だけ伝える
    console.error('[mocchin] mail failed', id, e instanceof Error ? e.message : e);
    mailed = false;
  }

  return {
    ok: true,
    no: formatMocchinNo(id),
    transferPrefix: mocchinTransferPrefix(id),
    payDeadline: mocchinPayDeadline(appliedOn),
    isMember: v.value.isMember,
    overCapacity,
    mailed,
  };
}
