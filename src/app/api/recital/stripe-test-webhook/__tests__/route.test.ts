// BW6 発表会（段階1）Task 22：試しの鍵の受け口（/api/recital/stripe-test-webhook）の試験。
// 発表会の記録（handleRecitalWebhook）は差しかえる。本物の Stripe は呼ばない。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

vi.mock('@/lib/recitalPayDb', () => ({ handleRecitalWebhook: vi.fn() }));

const SECRET = 'whsec_test_dummy_recital';

const { POST } = await import('../route');
const { handleRecitalWebhook } = await import('@/lib/recitalPayDb');
const handle = vi.mocked(handleRecitalWebhook);

function signed(event: unknown, secret = SECRET): NextRequest {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return new NextRequest('http://localhost/api/recital/stripe-test-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${v1}` } });
}

const event = {
  id: 'evt_t1', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_t1', payment_intent: 'pi_t1', amount_total: 26500, payment_status: 'paid', metadata: { recital_event_key: 't-pay', recital_household_id: '12' } } },
};

beforeEach(() => {
  handle.mockReset();
  vi.stubEnv('STRIPE_TEST_WEBHOOK_SECRET', SECRET);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('試しの鍵の受け口', () => {
  it('秘密が無ければ 500（発表会の分岐も呼ばない）', async () => {
    vi.stubEnv('STRIPE_TEST_WEBHOOK_SECRET', '');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(signed(event));
      expect(res.status).toBe(500);
    } finally {
      err.mockRestore();
    }
    expect(handle).not.toHaveBeenCalled();
  });
  it('署名がちがえば 400（本番の鍵の秘密で署名した物も通さない）', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test_dummy_main');
    const res = await POST(signed(event, 'whsec_test_dummy_main'));
    expect(res.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });
  it('JSON でなければ 400', async () => {
    const payload = 'not json';
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac('sha256', SECRET).update(`${t}.${payload}`).digest('hex');
    const res = await POST(new NextRequest('http://localhost/api/recital/stripe-test-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${v1}` } }));
    expect(res.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
  });
  it('発表会でない知らせは 200 not_recital（ほかの催しには流さない）', async () => {
    handle.mockResolvedValue({ handled: false });
    const res = await POST(signed(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: 'not_recital' });
  });
  it('handled:true の 200 はそのまま', async () => {
    handle.mockResolvedValue({ handled: true, httpStatus: 200, result: 'recital_paid' });
    const res = await POST(signed(event));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: 'recital_paid' });
    expect(handle).toHaveBeenCalledWith(event);
  });
  it('handled:true の 500 はそのまま', async () => {
    handle.mockResolvedValue({ handled: true, httpStatus: 500, result: 'recital_apply_failed' });
    const res = await POST(signed(event));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'apply failed' });
  });
});
