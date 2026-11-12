// BW6 発表会（段階1）のカードの決済の画面（Stripe Checkout）の作る・聞く・切る・鍵の選び方（Task 21）。
// 今ある催しの Stripe のファイル（bf6Stripe・mocchinStripe・kioskStripe）はさわらない（K131）。形だけそろえる。
// 試しと本番は設定 stripe_mode で選ぶ（初めの値 test）。test は STRIPE_TEST_SECRET_KEY だけを使い、本番の鍵へ落ちない。
// Stripe の中に世帯ごとの顧客は作らない（メールだけ渡す。K55・K172）。Stripe のエラーはログだけ（家庭には出さない）。
// ログに金額・メール・名前は出さない。
// U38（Task 22・Stripe の文書 docs.stripe.com/metadata で確かめた）：印は PaymentIntent → Charge にだけ写る（作った時の1回）。Refund・Dispute には写らないので、返金・異議（refund.*・charge.dispute.*）の知らせには印が乗らない（charge.refunded は Charge なので乗る）。

const STRIPE_API = 'https://api.stripe.com/v1/checkout/sessions';
const NOT_READY = 'カード決済は、準備中です';
const CREATE_FAILED = '決済ページの作成に失敗しました。時間をおいてお試しください';

export type RecitalStripeMode = 'test' | 'live';

export type RecitalCheckoutState = {
  status: string; payment_status: string; payment_intent: string | null; amount_total: number | null; url: string | null;
};

/** 決済の画面を作る時の引数（金額はサーバで計算した額。印は session と payment_intent_data の両方に入れる） */
export function buildRecitalCheckoutParams(p: {
  eventKey: string; householdId: number; checkoutId: number; amount: number; email: string | null; refCode: string;
  successUrl: string; cancelUrl: string; expiresAt: number;
}): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'payment');
  params.set('payment_method_types[0]', 'card');
  params.set('success_url', p.successUrl);
  params.set('cancel_url', p.cancelUrl);
  if (p.email) params.set('customer_email', p.email);
  params.set('client_reference_id', `recital-${p.householdId}-${p.checkoutId}`);
  for (const pre of ['metadata', 'payment_intent_data[metadata]']) {
    params.set(`${pre}[recital_event_key]`, p.eventKey);
    params.set(`${pre}[recital_household_id]`, String(p.householdId));
    params.set(`${pre}[recital_checkout_id]`, String(p.checkoutId));
  }
  params.set('expires_at', String(p.expiresAt));
  params.set('line_items[0][price_data][currency]', 'jpy');
  params.set('line_items[0][price_data][product_data][name]', `BW6 出演料（整理番号 ${p.refCode}）`);
  params.set('line_items[0][price_data][unit_amount]', String(p.amount));
  params.set('line_items[0][quantity]', '1');
  return params;
}

/** 鍵の選び方：test は STRIPE_TEST_SECRET_KEY（_test_ を含む物だけ）、live は STRIPE_SECRET_KEY。空は throw */
export function stripeKeyFor(mode: RecitalStripeMode): string {
  if (mode === 'test') {
    const key = (process.env.STRIPE_TEST_SECRET_KEY ?? '').trim();
    if (key === '' || !key.includes('_test_')) throw new Error(NOT_READY);
    return key;
  }
  if (mode === 'live') {
    const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
    if (key === '') throw new Error(NOT_READY);
    return key;
  }
  throw new Error(NOT_READY);
}

/** 決済の画面の番号の頭（cs_test_／cs_live_）から、作った時の試し・本番を出す。分からなければ null */
export function stripeModeForSession(sessionId: string): RecitalStripeMode | null {
  if (sessionId.startsWith('cs_test_')) return 'test';
  if (sessionId.startsWith('cs_live_')) return 'live';
  return null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripe の応答は動的構造 */
async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/** 決済の画面を作る。失敗は throw（文は家庭に出せる物だけ。Stripe のエラーはログだけ） */
export async function createRecitalCheckout(mode: RecitalStripeMode, params: URLSearchParams): Promise<{ id: string; url: string }> {
  const key = stripeKeyFor(mode);
  const res = await fetch(STRIPE_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const body = await readJson(res);
  if (!res.ok || !body?.url || !body?.id) {
    // Stripe の message はメールなどを含むことがあるので出さない（code・param・type だけ）
    console.error('[recital] checkout session create failed', res.status, body?.error?.code, body?.error?.param, body?.error?.type);
    throw new Error(CREATE_FAILED);
  }
  return { id: String(body.id), url: String(body.url) };
}

/** 決済の画面の今の状態を聞く。応答が ok でない・fetch が落ちた時は throw（「聞けなかった」を呼ぶ側に知らせる） */
export async function retrieveRecitalCheckout(mode: RecitalStripeMode, sessionId: string): Promise<RecitalCheckoutState> {
  const key = stripeKeyFor(mode);
  let res: Response;
  try {
    res = await fetch(`${STRIPE_API}/${encodeURIComponent(sessionId)}`, { method: 'GET', headers: { Authorization: `Bearer ${key}` } });
  } catch (e) {
    console.error('[recital] checkout session retrieve failed (fetch)', e instanceof Error ? e.message : String(e));
    throw new Error('recital_stripe:retrieve_failed');
  }
  const body = await readJson(res);
  if (!res.ok || !body || typeof body.status !== 'string') {
    console.error('[recital] checkout session retrieve failed', res.status, body?.error?.code, body?.error?.param, body?.error?.type);
    throw new Error('recital_stripe:retrieve_failed');
  }
  const pi = body.payment_intent;
  return {
    status: body.status,
    payment_status: typeof body.payment_status === 'string' ? body.payment_status : '',
    payment_intent: typeof pi === 'string' ? pi : typeof pi?.id === 'string' ? pi.id : null,
    amount_total: typeof body.amount_total === 'number' ? body.amount_total : null,
    url: typeof body.url === 'string' ? body.url : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 決済の画面を切る。失敗しても throw しない（false）。間に合わず払われた分は Task 22 が本物の額で受ける */
export async function expireRecitalCheckout(mode: RecitalStripeMode, sessionId: string): Promise<boolean> {
  if (!sessionId) return false;
  try {
    const key = stripeKeyFor(mode);
    const res = await fetch(`${STRIPE_API}/${encodeURIComponent(sessionId)}/expire`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Stripe の知らせを読む（Task 22） ----------

export type RecitalWebhookEvent = {
  eventId: string; type: string; livemode: boolean; eventKey: string; householdId: number; checkoutId: number | null;
  sessionId: string | null; piId: string | null; amountTotal: number | null; paymentStatus: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- Stripe の知らせは動的構造 */
function idOf(v: any): string | null {
  if (typeof v === 'string' && v !== '') return v;
  if (v && typeof v.id === 'string' && v.id !== '') return v.id;
  return null;
}

/**
 * 発表会の知らせだけを読む。見分けるのは印（metadata.recital_event_key と recital_household_id）だけで、種類では見分けない（K129）。
 * 印が無い・形がちがう知らせは null（今の流れ＝ほかの催しへ）。
 */
export function parseRecitalWebhookEvent(event: unknown): RecitalWebhookEvent | null {
  const e = event as any;
  if (!e || typeof e.id !== 'string' || e.id === '' || typeof e.type !== 'string') return null;
  const obj = e.data?.object;
  if (!obj || typeof obj !== 'object') return null;
  const meta = obj.metadata ?? {};
  const eventKey = meta.recital_event_key;
  const rawHid = meta.recital_household_id;
  if (typeof eventKey !== 'string' || eventKey.trim() === '') return null;
  if (rawHid == null || !/^\d+$/.test(String(rawHid))) return null;
  const rawCheckout = meta.recital_checkout_id;
  const objId = typeof obj.id === 'string' ? obj.id : '';
  let sessionId: string | null = null;
  let piId: string | null;
  if (objId.startsWith('cs_')) {
    sessionId = objId;
    piId = idOf(obj.payment_intent);
  } else if (objId.startsWith('pi_')) {
    piId = objId;
  } else {
    piId = idOf(obj.payment_intent);
  }
  return {
    eventId: e.id,
    type: e.type,
    livemode: e.livemode === true,
    eventKey,
    householdId: Number(rawHid),
    checkoutId: rawCheckout != null && /^\d+$/.test(String(rawCheckout)) ? Number(rawCheckout) : null,
    sessionId,
    piId,
    amountTotal: typeof obj.amount_total === 'number' ? obj.amount_total : null,
    paymentStatus: typeof obj.payment_status === 'string' ? obj.payment_status : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
