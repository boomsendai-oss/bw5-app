import { describe, it, expect } from 'vitest';
import { buildPartyLineItems, buildPartyCheckoutParams, parsePartyWebhookEvent } from '../partyStripe';

describe('buildPartyLineItems', () => {
  it('参加申込は 単価×人数 の1行', () => {
    expect(buildPartyLineItems({ kind: 'ticket', unitPrice: 2000, peopleCount: 3, memberCount: 0, teamName: '' })).toEqual([
      { name: 'BOOM クリスマスパーティー 2026 入場チケット(前売)', unitAmount: 2000, qty: 3 },
    ]);
  });
  it('エントリーは 出演料+参加費 の単価×メンバー数', () => {
    expect(buildPartyLineItems({ kind: 'entry', unitPrice: 4000, peopleCount: 0, memberCount: 4, teamName: 'BOOM KIDS' })).toEqual([
      { name: 'ショーケース出演(出演料+入場料) BOOM KIDS', unitAmount: 4000, qty: 4 },
    ]);
  });
});

describe('buildPartyCheckoutParams', () => {
  const p = buildPartyCheckoutParams({
    lineItems: [{ name: 'x', unitAmount: 2000, qty: 2 }],
    successUrl: 'https://a/ok',
    cancelUrl: 'https://a/ng',
    customerEmail: 'a@b.cc',
    orderId: 12,
    expiresAtEpochSec: 1800000000,
  });
  it('party_order_id で識別し、BF6の order_id は積まない', () => {
    expect(p.get('metadata[party_order_id]')).toBe('12');
    expect(p.get('metadata[order_id]')).toBeNull();
    expect(p.get('client_reference_id')).toBe('party-12');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('2000');
    expect(p.get('line_items[0][quantity]')).toBe('2');
    expect(p.get('expires_at')).toBe('1800000000');
  });
});

describe('parsePartyWebhookEvent', () => {
  const ev = (metadata: Record<string, string>) => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_intent: 'pi_1', amount_total: 4000, currency: 'jpy', metadata } },
  });
  it('party_order_id があれば拾う', () => {
    expect(parsePartyWebhookEvent(ev({ party_order_id: '5' }))).toEqual({
      eventId: 'evt_1', type: 'checkout.session.completed', sessionId: 'cs_1',
      paymentIntentId: 'pi_1', orderId: 5, amountTotal: 4000,
    });
  });
  it('BF6・Tシャツ・kioskのイベントは null', () => {
    expect(parsePartyWebhookEvent(ev({ order_id: '5' }))).toBeNull();
    expect(parsePartyWebhookEvent(ev({ tshirt_order_id: '5' }))).toBeNull();
    expect(parsePartyWebhookEvent(ev({ kiosk_order_id: '5' }))).toBeNull();
    expect(parsePartyWebhookEvent(null)).toBeNull();
  });
});
