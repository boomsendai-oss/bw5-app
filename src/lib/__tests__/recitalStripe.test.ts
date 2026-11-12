// BW6 発表会（段階1）の recitalStripe.ts（カードの決済の画面の作る・聞く・切る・鍵の選び方）の試験（純。Task 21）。
// 本物の Stripe は呼ばない（fetch は vi.stubGlobal で差しかえる）。鍵は試しの文字だけ。
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildRecitalCheckoutParams,
  createRecitalCheckout,
  expireRecitalCheckout,
  retrieveRecitalCheckout,
  stripeKeyFor,
  stripeModeForSession,
} from '../recitalStripe';

const base = { eventKey: 't-pay', householdId: 12, checkoutId: 34, amount: 26500, email: 'family@example.invalid', refCode: '1007', successUrl: 'https://event.boom-sendai.com/bw6/my?t=aa&paid=1', cancelUrl: 'https://event.boom-sendai.com/bw6/my?t=aa', expiresAt: 1765800000 };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('buildRecitalCheckoutParams', () => {
  it('params：金額はサーバの額・カードだけ・30分・印は session と payment_intent_data の両方', () => {
    const p = buildRecitalCheckoutParams(base);
    expect(p.get('mode')).toBe('payment');
    expect(p.get('payment_method_types[0]')).toBe('card');
    expect(p.get('payment_method_types[1]')).toBeNull();
    expect(p.get('line_items[0][price_data][currency]')).toBe('jpy');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('26500');
    expect(p.get('line_items[0][quantity]')).toBe('1');
    expect(p.get('line_items[0][price_data][product_data][name]')).toBe('BW6 出演料（整理番号 1007）');
    expect(p.get('expires_at')).toBe('1765800000');
    for (const pre of ['metadata', 'payment_intent_data[metadata]']) {
      expect(p.get(`${pre}[recital_event_key]`)).toBe('t-pay');
      expect(p.get(`${pre}[recital_household_id]`)).toBe('12');
      expect(p.get(`${pre}[recital_checkout_id]`)).toBe('34');
    }
    expect(p.get('client_reference_id')).toBe('recital-12-34');
    expect(p.get('customer_email')).toBe('family@example.invalid');
    expect(p.get('success_url')).toBe(base.successUrl);
    expect(p.get('cancel_url')).toBe(base.cancelUrl);
  });
  it('顧客を作らない', () => {
    const p = buildRecitalCheckoutParams(base);
    expect(p.has('customer')).toBe(false);
    expect(p.has('customer_creation')).toBe(false);
  });
  it('メールが無い世帯は customer_email を付けない', () => {
    expect(buildRecitalCheckoutParams({ ...base, email: null }).has('customer_email')).toBe(false);
  });
});

describe('stripeKeyFor', () => {
  it('stripeKeyFor：test は試しの鍵だけ・本番の鍵へ落ちない', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_x'); vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_y');
    expect(stripeKeyFor('test')).toBe('sk_test_y');
    expect(stripeKeyFor('live')).toBe('sk_live_x');
    vi.stubEnv('STRIPE_TEST_SECRET_KEY', '');
    expect(() => stripeKeyFor('test')).toThrow();
    vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_live_wrong');
    expect(() => stripeKeyFor('test')).toThrow();   // 試しの欄に本番の鍵が入っていたら使わない
  });
  it('live の鍵が空なら throw（文：カード決済は、準備中です）', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    expect(() => stripeKeyFor('live')).toThrow('カード決済は、準備中です');
  });
});

describe('stripeModeForSession', () => {
  it('番号の頭で試しか本番かを決める。分からなければ null', () => {
    expect(stripeModeForSession('cs_test_a1')).toBe('test');
    expect(stripeModeForSession('cs_live_a1')).toBe('live');
    expect(stripeModeForSession('cs_x')).toBeNull();
    expect(stripeModeForSession('')).toBeNull();
  });
});

describe('Stripe に聞く・切る・作る', () => {
  it('retrieve：聞けなかったら throw・開いていれば url を返す', async () => {
    vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_y');
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(500, { error: { code: 'api_error' } })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(retrieveRecitalCheckout('test', 'cs_1')).rejects.toThrow();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await expect(retrieveRecitalCheckout('test', 'cs_1')).rejects.toThrow();
    const f = vi.fn(async () => jsonRes(200, { status: 'open', payment_status: 'unpaid', url: 'https://checkout.stripe.com/c/pay/cs_1', payment_intent: null, amount_total: 26500 }));
    vi.stubGlobal('fetch', f);
    expect(await retrieveRecitalCheckout('test', 'cs_1')).toEqual({
      status: 'open', payment_status: 'unpaid', payment_intent: null, amount_total: 26500, url: 'https://checkout.stripe.com/c/pay/cs_1',
    });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_y');
  });
  it('expire：失敗しても throw せず false', async () => {
    vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_y');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await expireRecitalCheckout('test', 'cs_1')).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(400, {})));
    expect(await expireRecitalCheckout('test', 'cs_1')).toBe(false);
    const f = vi.fn(async () => jsonRes(200, {}));
    vi.stubGlobal('fetch', f);
    expect(await expireRecitalCheckout('test', 'cs_1')).toBe(true);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('https://api.stripe.com/v1/checkout/sessions/cs_1/expire');
    vi.stubEnv('STRIPE_TEST_SECRET_KEY', '');
    expect(await expireRecitalCheckout('test', 'cs_1')).toBe(false);   // 鍵が無くても throw しない
  });
  it('create：鍵は mode で選ぶ', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_x'); vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_y');
    const f = vi.fn(async () => jsonRes(200, { id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' }));
    vi.stubGlobal('fetch', f);
    const params = buildRecitalCheckoutParams(base);
    expect(await createRecitalCheckout('test', params)).toEqual({ id: 'cs_new', url: 'https://checkout.stripe.com/c/pay/cs_new' });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_y');
    expect(init.body).toBe(params.toString());
    await createRecitalCheckout('live', params);
    expect(((f.mock.calls[1] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe('Bearer sk_live_x');
  });
  it('create：作れなかったら throw（Stripe のエラーはログだけ）', async () => {
    vi.stubEnv('STRIPE_TEST_SECRET_KEY', 'sk_test_y');
    vi.stubGlobal('fetch', vi.fn(async () => jsonRes(400, { error: { code: 'parameter_invalid', message: 'x', param: 'customer_email', type: 'invalid_request_error' } })));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(createRecitalCheckout('test', buildRecitalCheckoutParams(base))).rejects.toThrow('決済ページの作成に失敗しました。時間をおいてお試しください');
    expect(err).toHaveBeenCalled();
    // Stripe の message（メールが入ることがある）はログに出さない
    expect(JSON.stringify(err.mock.calls)).not.toContain('"x"');
    expect(err.mock.calls[0]).toContain('parameter_invalid');
  });
});
