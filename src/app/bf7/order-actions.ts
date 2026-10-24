'use server';

// ⚠️ 公開Server Actions(認証なし)。理由: BOOMER'S FIGHT!!! vol.7 は外部参加者も対象の
// 公開イベントで、/bf7/entry・/bf7/ticket の公開フォームが叩くため(vol.6の actions.ts と同じ)。
// PII対策(M22): 名簿は getPublicBf7Entries(公開列=ダンサーネーム/ジャンル/REP/部門のみ)に限定。
// 本名・電話・メール・IGを返す公開経路は作らない。個別閲覧は edit_token 完全一致の1件のみ。
// 送信はIP単位のレート制限。金額は必ずサーバ側で再計算する。
// 確認用モード: 受付前でも、スタッフとしてログイン中(isAuthorizedServer=サーバ側で署名検証)なら
// 申込画面を表示し、当日現金に限ってテスト申込を通す。カードは本物の請求になるので通さない。
// テスト申込には印を付け、定員と公開エントリーリストに数えない(bf7EntryDb の BF7_STAFF_TEST_NOTE)。
import { headers } from 'next/headers';
import { checkRateLimit, isAuthorizedServer } from '@/lib/eventAuth';
import { validateBf6Order, type Bf6OrderInput, type Bf6Pricing, type Bf6Division } from '@/lib/bf6';
import { bf7SalesGateError, isBf7EntryAccepting, isBf7TicketAccepting } from '@/lib/bf7Entry';
import {
  calcBf7Remaining,
  createBf7Order,
  getBf7Settings,
  getBf7Usage,
  getPublicBf7Entries,
  loadBf7OrderByToken,
  markBf7StaffTestOrder,
  saveBf7StripeSession,
  type PublicBf7Entry,
} from '@/lib/bf7EntryDb';
import { buildBf7CheckoutFormParams, buildBf7LineItems, createBf7CheckoutSession } from '@/lib/bf7Stripe';
import { sendBf7OrderEmail } from '@/lib/bf7Email';
import { todayJst } from '@/lib/dateJst';

async function clientIp(): Promise<string> {
  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  return xff.split(',')[0].trim() || 'unknown';
}

export interface Bf7PublicContext {
  entryOpen: boolean;
  ticketOpen: boolean;
  pricing: Bf6Pricing;
  capacity: Record<Bf6Division, number>;
  remaining: { divisions: Record<Bf6Division, number>; tickets: number };
  entryStart: string;
  entryDeadline: string;
  ticketStart: string;
  ticketDeadline: string;
  /** サーバ基準の今日(JST)。端末の時計ズレで表示と請求が食い違わないように使う */
  today: string;
  /** 受付前だがスタッフのログイン中なので、確認のために画面を開いている */
  preview: boolean;
}

// 公開: 料金・残枠・受付状態(いずれも公開情報)を返す。名簿・PIIは含まない。
export async function getBf7Context(): Promise<Bf7PublicContext> {
  const settings = await getBf7Settings();
  const usage = await getBf7Usage();
  const today = todayJst();
  const entryAccepting = isBf7EntryAccepting(settings, today);
  const ticketAccepting = isBf7TicketAccepting(settings, today);
  const staff = !(entryAccepting && ticketAccepting) && (await isAuthorizedServer());
  return {
    entryOpen: entryAccepting || staff,
    ticketOpen: ticketAccepting || staff,
    pricing: settings.pricing,
    capacity: settings.capacity,
    remaining: calcBf7Remaining(settings, usage),
    entryStart: settings.entryStart,
    entryDeadline: settings.entryDeadline,
    ticketStart: settings.ticketStart,
    ticketDeadline: settings.ticketDeadline,
    today,
    preview: staff,
  };
}

export type Bf7SubmitResult =
  | { ok: true; token: string; payMethod: 'prepaid' | 'onsite'; amountTotal: number }
  | { ok: false; error: string };

export async function submitBf7Order(payload: Bf6OrderInput): Promise<Bf7SubmitResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf7order:${ip}`, 20, 3600))) {
    return { ok: false, error: '送信が多すぎます。しばらくしてからお試しください' };
  }
  const settings = await getBf7Settings();
  const validated = validateBf6Order(payload);
  if (typeof validated === 'string') return { ok: false, error: validated };
  const gateError = bf7SalesGateError(validated, settings);
  // 受付前・締切後でも、スタッフの確認用テスト(当日現金のみ)は通す
  const staffTest = Boolean(gateError) && (await isAuthorizedServer());
  if (gateError && !staffTest) return { ok: false, error: gateError };
  if (staffTest && validated.payMethod !== 'onsite') {
    return { ok: false, error: '確認用モードではカード決済は選べません(本物の請求になるため)。「当日会場でお支払い」で試してください' };
  }
  const created = await createBf7Order(validated);
  if (!created.ok) return { ok: false, error: created.error };
  if (staffTest) await markBf7StaffTestOrder(created.editToken);
  if (validated.payMethod === 'onsite') {
    // 当日現金は申込した時点で確定=このタイミングで受付メールを送る(カードはWebhookで決済確定時)
    const order = await loadBf7OrderByToken(created.editToken);
    if (order) await sendBf7OrderEmail(order, created.editToken);
  }
  return { ok: true, token: created.editToken, payMethod: validated.payMethod, amountTotal: created.amountTotal };
}

// 公開: エントリーリスト(ダンサーネーム/ジャンル/REP/部門のみ)。
export async function getBf7EntryList(): Promise<PublicBf7Entry[]> {
  return getPublicBf7Entries();
}

export type Bf7CheckoutResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Stripe Checkoutへの遷移。金額・明細はDBに保存済みの注文からサーバ側で組み立てる
 * (クライアント申告額は一切使わない)。決済確定はWebhook側が正本。
 */
export async function startBf7Checkout(token: string): Promise<Bf7CheckoutResult> {
  const ip = await clientIp();
  if (!(await checkRateLimit(`bf7pay:${ip}`, 30, 3600))) {
    return { ok: false, error: '操作が多すぎます。しばらくしてからお試しください' };
  }
  if (!token) return { ok: false, error: '申込が見つかりません' };
  const order = await loadBf7OrderByToken(token);
  if (!order) return { ok: false, error: '申込が見つかりません' };
  if (order.paymentStatus === 'paid') return { ok: false, error: 'この申込はお支払い済みです' };
  if (order.paymentStatus === 'expired') {
    return { ok: false, error: '30分以内に決済が完了しなかったため、この申込は無効になりました。お手数ですがもう一度お申し込みください' };
  }
  if (order.payMethod !== 'prepaid' || order.paymentStatus !== 'pending') {
    return { ok: false, error: 'この申込はカード決済の対象ではありません' };
  }

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'bw5-app.vercel.app';
  const proto = h.get('x-forwarded-proto') ?? 'https';
  const completeUrl = `${proto}://${host}/bf7/complete?t=${token}`;

  try {
    const params = buildBf7CheckoutFormParams({
      lineItems: buildBf7LineItems(order),
      successUrl: completeUrl,
      cancelUrl: completeUrl,
      customerEmail: order.email,
      orderId: order.orderId,
      expiresAtEpochSec: Math.floor(Date.now() / 1000) + 30 * 60,
    });
    const session = await createBf7CheckoutSession(params);
    await saveBf7StripeSession(order.orderId, session.id);
    return { ok: true, url: session.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '決済ページの作成に失敗しました' };
  }
}
