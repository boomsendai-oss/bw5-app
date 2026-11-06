'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: HIRO ワークショップは会員以外(東北・北陸の方)も申し込めるため、
// /bf7/workshop の公開フォームが叩く。
// PII対策: 申込を読み出す公開経路は作らない(個別閲覧は edit_token 完全一致の1件のみ)。送信はIP単位のレート制限。
// ⚠️ 会員データとの照合結果は返さない(名前を入れて会員かどうかを調べられてしまうため)。結果はスタッフ画面だけに出す。
// 金額はサーバ側で決める。確認用モード: 受付前でもスタッフのログイン中はテスト申込を通す(定員に数えない・カードは本物の請求なので¥100で試す)。
import { headers } from 'next/headers';
import { checkRateLimit, isAuthorizedServer } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { sendEmail } from '@/lib/email';
import {
  buildBf7WsEmail,
  bf7WsClassLines,
  bf7WsCourseUses,
  bf7WsGate,
  bf7WsGateError,
  checkBf7WsMember,
  validateBf7WsInput,
  type Bf7WsBankAccount,
  type Bf7WsFieldErrors,
  type Bf7WsInput,
  type Bf7WsMemberCheck,
} from '@/lib/bf7Workshop';
import {
  createBf7WsOrder,
  listBf7WsMatchableMembers,
  loadBf7WsOrderByToken,
  saveBf7WsBankTransfer,
  saveBf7WsStripeSession,
} from '@/lib/bf7WorkshopDb';
import { buildBf7WsCheckoutFormParams, createBf7WsBankTransfer, createBf7WsCheckoutSession } from '@/lib/bf7WorkshopStripe';

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
}

export type Bf7WsSubmitResult =
  | { ok: true; token: string; payMethod: 'prepaid' | 'transfer' }
  | { ok: false; error: string; fieldErrors?: Bf7WsFieldErrors };

export async function submitBf7Ws(input: Bf7WsInput): Promise<Bf7WsSubmitResult> {
  if (!(await checkRateLimit(`bf7ws:${await clientIp()}`, 10, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const v = validateBf7WsInput(input);
  if (!v.ok) return { ok: false, error: '入力内容を確認してください', fieldErrors: v.errors };

  const gateErr = bf7WsGateError(bf7WsGate(todayJst()), v.value.isMember);
  const isTest = Boolean(gateErr) && (await isAuthorizedServer());
  if (gateErr && !isTest) return { ok: false, error: gateErr };

  // 照合に失敗しても申込は止めない(スタッフの確認に回す)
  let memberResult: Bf7WsMemberCheck | null = null;
  if (v.value.isMember) {
    try {
      memberResult = checkBf7WsMember(v.value.name, v.value.kana, await listBf7WsMatchableMembers());
    } catch (e) {
      console.error('[bf7ws] member check failed', e instanceof Error ? e.message : e);
    }
  }

  const created = await createBf7WsOrder(v.value, memberResult, isTest);
  if (!created.ok) return { ok: false, error: created.error };

  if (v.value.payMethod === 'transfer') {
    // 銀行振込は Stripe でその人専用の振込先を作る(入金は自動で確認される・TARO 2026-11-06)。
    // 作れなかったときは固定の口座(BF7_WS_BANK)を案内する(入金はGMOの明細で照合)
    const use = bf7WsCourseUses(v.value.course);
    let bankAccount: Bf7WsBankAccount | null = null;
    try {
      const t = await createBf7WsBankTransfer({
        orderId: created.id,
        amount: created.amountTotal,
        email: v.value.email,
        name: v.value.name,
        description: `${isTest ? '【動作確認】' : ''}HIRO WORKSHOP 2027/1/31 ${bf7WsClassLines(use.first, use.second).map((c) => c.split(' ')[0]).join('・')}`,
      });
      await saveBf7WsBankTransfer(created.id, t.paymentIntentId, t.bankAccount);
      bankAccount = t.bankAccount;
    } catch (e) {
      console.error('[bf7ws] bank transfer setup failed, fallback to fixed account. order:', created.id, e instanceof Error ? e.message : e);
    }
    // 銀行振込は申込の時点で振込先を送る(カードは決済確定の通知を受けたとき)
    try {
      const mail = buildBf7WsEmail({
        id: created.id,
        name: v.value.name,
        first: use.first,
        second: use.second,
        amountTotal: created.amountTotal,
        payMethod: 'transfer',
        isMember: v.value.isMember,
        paid: false,
        appliedOn: created.appliedOn,
        bankAccount,
      });
      await sendEmail({ to: v.value.email, subject: mail.subject, text: mail.text });
    } catch (e) {
      // 申込は保存済み。完了画面に受付番号と振込先を出すので、ここでは止めない
      console.error('[bf7ws] mail failed', created.id, e instanceof Error ? e.message : e);
    }
  }
  return { ok: true, token: created.token, payMethod: v.value.payMethod };
}

export type Bf7WsCheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/** Stripeの決済画面へ。金額と明細は保存済みの申込から組み立てる(画面から送られた金額は使わない) */
export async function startBf7WsCheckout(token: string): Promise<Bf7WsCheckoutResult> {
  if (!(await checkRateLimit(`bf7wspay:${await clientIp()}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  const order = await loadBf7WsOrderByToken(token);
  if (!order) return { ok: false, error: '申込が見つかりません' };
  if (order.paymentStatus === 'paid') return { ok: false, error: 'この申込はお支払い済みです' };
  if (order.paymentStatus === 'expired') {
    return { ok: false, error: '30分以内に決済が完了しなかったため、この申込は無効になりました。お手数ですがもう一度お申し込みください' };
  }
  if (order.payMethod !== 'prepaid' || order.paymentStatus !== 'pending') {
    return { ok: false, error: 'この申込はカード決済の対象ではありません' };
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'boomersfight.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const completeUrl = `${proto}://${host}/bf7/workshop/complete?t=${token}`;
  // 決済画面でも「何本目・何時から」が分かるようにする
  const classes = bf7WsClassLines(order.first, order.second).map((c) => c.split(' ').slice(0, 2).join(' ')).join('・');

  try {
    const session = await createBf7WsCheckoutSession(
      buildBf7WsCheckoutFormParams({
        itemName: `${order.isTest ? '【動作確認】' : ''}HIRO WORKSHOP 2027/1/31(${classes})`,
        amount: order.amountTotal,
        successUrl: completeUrl,
        cancelUrl: completeUrl,
        customerEmail: order.email,
        orderId: order.id,
        expiresAtEpochSec: Math.floor(Date.now() / 1000) + 30 * 60,
      })
    );
    await saveBf7WsStripeSession(order.id, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}
