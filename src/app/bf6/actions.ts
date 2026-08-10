'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BOOMER'S FIGHT vol.6 は外部参加者も対象の
// 公開イベントで、/bf6/entry・/bf6/ticket の公開フォームが叩くため。
// PII対策(M22): 名簿系はgetPublicBf6Entries(公開列=ダンサーネーム/ジャンル/REP/部門のみ)に限定。
// 本名・電話・メール・IGを返す公開経路は作らない。個別閲覧はedit_token完全一致の1件のみ。
// 送信はIP単位のレート制限。金額は必ずサーバ側で再計算する。
import { headers } from 'next/headers';
import { checkRateLimit } from '@/lib/eventAuth';
import {
  isPastDeadlineJst,
  validateBf6Order,
  type Bf6OrderInput,
  type Bf6Pricing,
  type Bf6Division,
} from '@/lib/bf6';
import {
  calcBf6Remaining,
  countBf6SsmFreeOrders,
  createBf6Order,
  createBf6SsmFreeOrder,
  getBf6Settings,
  getBf6SsmConfig,
  getBf6Usage,
  getPublicBf6Entries,
  loadBf6OrderByToken,
  saveBf6StripeSession,
  type PublicBf6Entry,
} from '@/lib/bf6Db';
import {
  buildBf6LineItems,
  buildCheckoutFormParams,
  createBf6CheckoutSession,
} from '@/lib/bf6Stripe';
import { sendBf6OrderEmail } from '@/lib/bf6Email';
import { validateBf6SsmEntry, type Bf6SsmEntryInput } from '@/lib/bf6';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export interface Bf6PublicContext {
  entryOpen: boolean;
  ticketOpen: boolean;
  pricing: Bf6Pricing;
  capacity: Record<Bf6Division, number>;
  remaining: { divisions: Record<Bf6Division, number>; tickets: number };
  entryDeadline: string;
  ticketDeadline: string;
}

// 公開: 料金・残枠・受付状態(いずれも公開情報)を返す。名簿・PIIは含まない。
export async function getBf6Context(): Promise<Bf6PublicContext> {
  const settings = await getBf6Settings();
  const usage = await getBf6Usage();
  const remaining = calcBf6Remaining(settings, usage);
  return {
    entryOpen: settings.entryOpen && !isPastDeadlineJst(settings.entryDeadline),
    ticketOpen: settings.ticketOpen && !isPastDeadlineJst(settings.ticketDeadline),
    pricing: settings.pricing,
    capacity: settings.capacity,
    remaining,
    entryDeadline: settings.entryDeadline,
    ticketDeadline: settings.ticketDeadline,
  };
}

export type Bf6SubmitResult =
  | { ok: true; token: string; payMethod: 'prepaid' | 'onsite'; amountTotal: number }
  | { ok: false; error: string };

export async function submitBf6Order(payload: Bf6OrderInput): Promise<Bf6SubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const settings = await getBf6Settings();
  const validated = validateBf6Order(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const isEntry = validated.entries.length > 0;
  if (isEntry && (!settings.entryOpen || isPastDeadlineJst(settings.entryDeadline))) {
    return { ok: false, error: '現在エントリーは受け付けていません' };
  }
  if (!isEntry && (!settings.ticketOpen || isPastDeadlineJst(settings.ticketDeadline))) {
    return { ok: false, error: '現在観覧チケットの販売は行っていません' };
  }
  const created = await createBf6Order(validated);
  if (!created.ok) return { ok: false, error: created.error };
  if (validated.payMethod === 'onsite') {
    // 当日現金は申込した時点で確定=このタイミングで受付メールを送る
    // (カード決済はWebhookでpaidになった瞬間に送る)
    const order = await loadBf6OrderByToken(created.editToken);
    if (order) await sendBf6OrderEmail(order, created.editToken);
  }
  return {
    ok: true,
    token: created.editToken,
    payMethod: validated.payMethod,
    amountTotal: created.amountTotal,
  };
}

// 公開: エントリーリスト(ダンサーネーム/ジャンル/REP/部門のみ)。
export async function getBf6EntryList(): Promise<PublicBf6Entry[]> {
  return getPublicBf6Entries();
}

export type Bf6CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Stripe Checkoutへの遷移。金額・明細はDBに保存済みの注文からサーバ側で組み立てる
 * (クライアント申告額は一切使わない)。決済確定はWebhook側が正本。
 */
export async function startBf6Checkout(token: string): Promise<Bf6CheckoutResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6pay:${ip}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  if (!token) return { ok: false, error: '申込が見つかりません' };
  const order = await loadBf6OrderByToken(token);
  if (!order) return { ok: false, error: '申込が見つかりません' };
  if (order.paymentStatus === 'paid') return { ok: false, error: 'この申込はお支払い済みです' };
  if (order.paymentStatus === 'expired') {
    return { ok: false, error: '30分以内に決済が完了しなかったため、この申込は無効になりました。お手数ですがもう一度エントリーしてください' };
  }
  if (order.payMethod !== 'prepaid' || order.paymentStatus !== 'pending') {
    return { ok: false, error: 'この申込はカード決済の対象ではありません' };
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'bw5-app.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const completeUrl = `${proto}://${host}/bf6/complete?t=${token}`;

  try {
    const params = buildCheckoutFormParams({
      lineItems: buildBf6LineItems(order),
      successUrl: completeUrl,
      cancelUrl: completeUrl,
      customerEmail: order.email,
      orderId: order.orderId,
      expiresAtEpochSec: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    const session = await createBf6CheckoutSession(params);
    await saveBf6StripeSession(order.orderId, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}

// ───────────────────────── SSM学生無料枠 ─────────────────────────
// 招待コードはサーバー側でのみ照合する(コードなしでは状態も申込も返さない)。

export type Bf6SsmStatus =
  | { ok: true; remaining: number }
  | { ok: false; reason: 'code' | 'closed' | 'full' };

function isBeforeStartJst(start: string, now: Date = new Date()): boolean {
  if (!start) return false;
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return jst < start;
}

async function checkSsmGate(code: string): Promise<Bf6SsmStatus & { limit?: number }> {
  const cfg = await getBf6SsmConfig();
  if (!cfg.code || (code ?? '').trim().toUpperCase() !== cfg.code.toUpperCase()) {
    return { ok: false, reason: 'code' };
  }
  if (isBeforeStartJst(cfg.start) || isPastDeadlineJst(cfg.deadline)) {
    return { ok: false, reason: 'closed' };
  }
  const used = await countBf6SsmFreeOrders();
  if (used >= cfg.limit) return { ok: false, reason: 'full' };
  return { ok: true, remaining: cfg.limit - used, limit: cfg.limit };
}

/** コードが正しい場合のみ残枠を返す。 */
export async function getBf6SsmStatus(code: string): Promise<Bf6SsmStatus> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6ssm:${ip}`, 30, 3600))) {
    return { ok: false, reason: 'code' };
  }
  const gate = await checkSsmGate(code);
  return gate.ok ? { ok: true, remaining: gate.remaining } : gate;
}

export async function submitBf6SsmEntry(
  code: string,
  payload: Bf6SsmEntryInput
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf6ssm:${ip}`, 30, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const gate = await checkSsmGate(code);
  if (!gate.ok) {
    return {
      ok: false,
      error:
        gate.reason === 'code'
          ? '招待コードが正しくありません'
          : gate.reason === 'full'
            ? 'SSM学生無料枠は埋まりました'
            : '現在SSM学生枠の受付期間外です',
    };
  }
  const validated = validateBf6SsmEntry(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const created = await createBf6SsmFreeOrder(validated, gate.limit ?? 6);
  if (!created.ok) return { ok: false, error: created.error };
  // 無料=即確定なので、このタイミングで確定メールを送る
  const order = await loadBf6OrderByToken(created.editToken);
  if (order) await sendBf6OrderEmail(order, created.editToken);
  return { ok: true, token: created.editToken };
}
