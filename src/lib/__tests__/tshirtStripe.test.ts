import { describe, it, expect } from 'vitest';
import {
  buildTshirtLineItems,
  buildTshirtCheckoutParams,
  parseTshirtWebhookEvent,
} from '../tshirtStripe';

const order = {
  id: 7,
  size: 'L' as const,
  qty: 2,
  wantsShipping: false,
  unitPrice: 3500,
  shippingFee: 0,
  totalAmount: 7000,
};

describe('buildTshirtLineItems', () => {
  it('Tシャツ本体は注文時の単価×枚数(サイズ入りの表示名)', () => {
    const items = buildTshirtLineItems(order);
    expect(items).toEqual([
      { name: 'BOOM オフィシャルTシャツ（黒×黒モデル） Lサイズ', unitAmount: 3500, qty: 2 },
    ]);
  });

  it('郵送希望なら送料を別明細で1回だけ足す', () => {
    const items = buildTshirtLineItems({ ...order, wantsShipping: true, shippingFee: 800, totalAmount: 7800 });
    expect(items).toEqual([
      { name: 'BOOM オフィシャルTシャツ（黒×黒モデル） Lサイズ', unitAmount: 3500, qty: 2 },
      { name: '郵送料（何枚でも一律）', unitAmount: 800, qty: 1 },
    ]);
  });

  it('明細合計はDB保存のtotal_amountと一致する(サーバ側計算の整合)', () => {
    const o = { ...order, wantsShipping: true, shippingFee: 800, totalAmount: 7800 };
    const sum = buildTshirtLineItems(o).reduce((n, i) => n + i.unitAmount * i.qty, 0);
    expect(sum).toBe(o.totalAmount);
  });
});

describe('buildTshirtCheckoutParams', () => {
  it('metadata[tshirt_order_id]で注文を識別できる(BF6と衝突しない)', () => {
    const p = buildTshirtCheckoutParams({
      lineItems: buildTshirtLineItems(order),
      successUrl: 'https://x/merch/tshirt?t=abc',
      cancelUrl: 'https://x/merch/tshirt?t=abc&cancel=1',
      orderId: 7,
      expiresAtEpochSec: 1000,
    });
    expect(p.get('mode')).toBe('payment');
    expect(p.get('metadata[tshirt_order_id]')).toBe('7');
    expect(p.get('metadata[order_id]')).toBeNull();
    expect(p.get('line_items[0][price_data][currency]')).toBe('jpy');
    expect(p.get('line_items[0][price_data][unit_amount]')).toBe('3500');
    expect(p.get('line_items[0][quantity]')).toBe('2');
    expect(p.get('expires_at')).toBe('1000');
    expect(p.get('customer_email')).toBeNull();
  });
});

describe('parseTshirtWebhookEvent', () => {
  const ev = (meta: Record<string, string>) => ({
    id: 'evt_1', type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', payment_intent: 'pi_1', amount_total: 7000, currency: 'jpy', metadata: meta } },
  });

  it('tshirt_order_id付きイベントだけ拾う', () => {
    const r = parseTshirtWebhookEvent(ev({ tshirt_order_id: '7' }));
    expect(r).toEqual({
      eventId: 'evt_1', type: 'checkout.session.completed',
      sessionId: 'cs_1', paymentIntentId: 'pi_1', orderId: 7, amountTotal: 7000, currency: 'jpy',
    });
  });

  it('BF6のイベント(order_id)は拾わない', () => {
    expect(parseTshirtWebhookEvent(ev({ order_id: '7' }))).toBeNull();
  });

  it('壊れたイベントはnull', () => {
    expect(parseTshirtWebhookEvent(null)).toBeNull();
    expect(parseTshirtWebhookEvent({})).toBeNull();
  });
});
