// BW6 発表会（段階1）Task 22：本番の鍵の受け口（/api/bf6/stripe-webhook）に足した発表会の分岐の試験。
// 発表会の記録（handleRecitalWebhook）と MOCCHIN の記録は差しかえる。ほかの部品は本物のまま読む。本物の Stripe は呼ばない。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { NextRequest } from 'next/server';

// 万一 DB に触れても本番に向かないように（差しかえているので触れないはず）
process.env.TURSO_DATABASE_URL = 'file:./data/test_recital_webhook_route.db';
delete process.env.TURSO_AUTH_TOKEN;

vi.mock('@/lib/recitalPayDb', () => ({ handleRecitalWebhook: vi.fn() }));
vi.mock('@/lib/mocchinEntryDb');

const SECRET = 'whsec_test_dummy_main';
process.env.STRIPE_WEBHOOK_SECRET = SECRET;

const { POST } = await import('../route');
const { handleRecitalWebhook } = await import('@/lib/recitalPayDb');
const { applyMocchinWebhookEvent } = await import('@/lib/mocchinEntryDb');
const handle = vi.mocked(handleRecitalWebhook);
const applyMocchin = vi.mocked(applyMocchinWebhookEvent);

function signed(event: unknown, secret = SECRET): NextRequest {
  const payload = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return new NextRequest('http://localhost/api/bf6/stripe-webhook', { method: 'POST', body: payload, headers: { 'stripe-signature': `t=${t},v1=${v1}` } });
}

const mocchinMeta = { mocchin_entry_id: '5', mocchin_step: '0' };
const recitalMeta = { recital_event_key: 't-pay', recital_household_id: '12', recital_checkout_id: '34' };
const completed = (metadata: Record<string, string>) => ({
  id: 'evt_route_1', type: 'checkout.session.completed', livemode: false,
  data: { object: { id: 'cs_test_r1', payment_intent: 'pi_r1', amount_total: 26500, payment_status: 'paid', metadata } },
});
const mocchinLikeEventWithRecitalMeta = completed({ ...mocchinMeta, ...recitalMeta });

beforeEach(() => {
  handle.mockReset();
  applyMocchin.mockReset();
});

describe('本番の鍵の受け口：発表会の分岐', () => {
  it('発表会の知らせは発表会の分岐で返し、MOCCHIN に流さない', async () => {
    handle.mockResolvedValue({ handled: true, httpStatus: 200, result: 'recital_paid' });
    const res = await POST(signed(mocchinLikeEventWithRecitalMeta));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, result: 'recital_paid' });
    expect(applyMocchin).not.toHaveBeenCalled();
    expect(handle).toHaveBeenCalledWith(mocchinLikeEventWithRecitalMeta);
  });
  it('handled:false なら今の流れ（MOCCHIN）へ', async () => {
    handle.mockResolvedValue({ handled: false });
    applyMocchin.mockResolvedValue({ status: 'entry_not_found' } as Awaited<ReturnType<typeof applyMocchinWebhookEvent>>);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await POST(signed(completed(mocchinMeta)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true, result: 'mocchin_entry_not_found' });
    } finally {
      err.mockRestore();
    }
    expect(handle).toHaveBeenCalledTimes(1);
    expect(applyMocchin).toHaveBeenCalledTimes(1);
  });
  it('発表会の適用失敗は 500', async () => {
    handle.mockResolvedValue({ handled: true, httpStatus: 500, result: 'recital_apply_failed' });
    const res = await POST(signed(completed(recitalMeta)));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'apply failed' });
    expect(applyMocchin).not.toHaveBeenCalled();
  });
  it('署名がちがえば発表会の分岐も呼ばない（400）', async () => {
    const res = await POST(signed(completed(recitalMeta), 'whsec_wrong'));
    expect(res.status).toBe(400);
    expect(handle).not.toHaveBeenCalled();
    expect(applyMocchin).not.toHaveBeenCalled();
  });
});
