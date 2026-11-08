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
  mocchinNextStep,
  mocchinPaySteps,
  mocchinPayUrl,
  paidStepSet,
  mocchinTransferPrefix,
  validateMocchinInput,
  LESSON_PLANS,
  MOCCHIN_PLAN_INVITE_FROM,
  mocchinNeedsLessonPlan,
  type FieldErrors,
  type MocchinInput,
  type MocchinPayStep,
} from '@/lib/mocchinEntry';
import {
  MOCCHIN_SETTINGS_KEY,
  countActiveMocchin,
  createMocchinEntry,
  getMocchinCapacity,
  isMocchinTestEntry,
  loadMocchinEntryByToken,
  mocchinCardAmount,
  saveMocchinCheckout,
  setMocchinLessonPlan,
  setMocchinStaffNote,
} from '@/lib/mocchinEntryDb';
import { MOCCHIN_CHECKOUT_MINUTES, buildMocchinCheckoutFormParams, createMocchinCheckoutSession } from '@/lib/mocchinStripe';
import { retrieveCheckoutSession } from '@/lib/partyStripe';

export type MocchinSubmitResult =
  | { ok: true; no: string; transferPrefix: string; steps: MocchinPayStep[]; payMethod: string; payToken: string; overCapacity: boolean; mailed: boolean }
  | { ok: false; error: string; fieldErrors?: FieldErrors };

async function ip(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export async function submitMocchinEntry(input: MocchinInput, preview?: string): Promise<MocchinSubmitResult> {
  if (!(await checkRateLimit(`mocchin:${await ip()}`, 10, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  // 申込のときは参加費だけ(2026-11-08 TARO)。払い方は画面からの値を使わず、ここで決める
  const v = validateMocchinInput({ ...input, paymentPlan: 'pending' });
  if (!v.ok) return { ok: false, error: '入力内容を確認してください', fieldErrors: v.errors };

  // プレビュー鍵つき(スタッフの事前確認)のときだけ、受付期間の外でも送れる。保存した行には印を付ける
  const isPreview = isXmasPreview(MOCCHIN_SETTINGS_KEY, preview);
  if (!isPreview) {
    const gateErr = mocchinGateError(mocchinGate(todayJst()), v.value.isMember);
    if (gateErr) return { ok: false, error: gateErr };
  }

  const before = await countActiveMocchin();
  const capacity = await getMocchinCapacity();
  const { id, appliedOn, payToken } = await createMocchinEntry(v.value);
  if (isPreview) await setMocchinStaffNote(id, 'プレビューから送信(テスト)');
  const overCapacity = before + 1 > capacity;

  let mailed = true;
  try {
    const mail = buildMocchinEmail({ id, name: v.value.name, appliedOn, isMember: v.value.isMember, paymentPlan: v.value.paymentPlan, payMethod: v.value.payMethod, payToken, overCapacity });
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
    steps: mocchinPaySteps(v.value.paymentPlan, v.value.isMember, appliedOn),
    payMethod: v.value.payMethod,
    payToken,
    overCapacity,
    mailed,
  };
}

export type MocchinCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Stripeの決済画面へ。払う回と金額は保存済みの申込から決める(画面から送られた金額は使わない) */
export async function startMocchinCheckout(token: string): Promise<MocchinCheckoutResult> {
  if (!(await checkRateLimit(`mocchinpay:${await ip()}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const e = await loadMocchinEntryByToken(token);
  if (!e || e.status !== 'active') return { ok: false, error: '申込が見つかりません' };
  const steps = mocchinPaySteps(e.paymentPlan, e.isMember, e.appliedOn);
  const step = mocchinNextStep(steps, paidStepSet(e.paid, e.lessonPaid));
  if (!step) return { ok: false, error: 'お支払いはすべて完了しています' };

  // 同じ回の決済画面がまだ開いていれば使い回す(別の画面で二重に払えないように)
  if (e.checkoutSessionId && e.checkoutStep === step.step) {
    const prev = await retrieveCheckoutSession(e.checkoutSessionId);
    if (prev.status === 'complete') return { ok: false, error: 'このお支払いは完了しています。反映まで少しお待ちください' };
    if (prev.status === 'open' && prev.url) return { ok: true, url: prev.url };
  }

  const back = mocchinPayUrl(token);
  try {
    const session = await createMocchinCheckoutSession(
      buildMocchinCheckoutFormParams({
        itemName: `${isMocchinTestEntry(e) ? '【動作確認】' : ''}BW6 スペシャルナンバー by MOCCHIN ${step.label}(${formatMocchinNo(e.id)})`,
        amount: mocchinCardAmount(e, step),
        successUrl: back,
        cancelUrl: back,
        customerEmail: e.email,
        entryId: e.id,
        step: step.step,
        expiresAtEpochSec: Math.floor(Date.now() / 1000) + MOCCHIN_CHECKOUT_MINUTES * 60,
      })
    );
    await saveMocchinCheckout(e.id, session.id, step.step);
    return { ok: true, url: session.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : '決済画面の作成に失敗しました' };
  }
}

export type MocchinPlanResult = { ok: true } | { ok: false; error: string };

/** レッスン代の払い方を選ぶ(締切後・参加費を払った人だけ)。テスト申込は日付を問わず選べる */
export async function chooseMocchinLessonPlan(token: string, plan: string): Promise<MocchinPlanResult> {
  if (!(await checkRateLimit(`mocchinplan:${await ip()}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  if (!(LESSON_PLANS as readonly string[]).includes(plan)) return { ok: false, error: '払い方を選んでください' };
  const e = await loadMocchinEntryByToken(token);
  if (!e || e.status !== 'active') return { ok: false, error: '申込が見つかりません' };
  if (!mocchinNeedsLessonPlan(e)) return { ok: false, error: '払い方はすでに決まっているか、まだ選べる状態ではありません' };
  if (!isMocchinTestEntry(e) && todayJst() < MOCCHIN_PLAN_INVITE_FROM) return { ok: false, error: 'レッスン代の払い方は、締切のあとに選べます' };
  const changed = await setMocchinLessonPlan(e.id, plan);
  return changed ? { ok: true } : { ok: false, error: '払い方はすでに決まっています' };
}
