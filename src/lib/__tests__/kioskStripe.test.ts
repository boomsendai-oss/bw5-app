// kiosk の Stripe 連携ユニット。署名検証は bf6Stripe の実装(テスト済み)を再利用するため、
// ここでは Checkout パラメータの組み立てと Webhook イベントの解析だけを見る。
import { describe, it, expect } from 'vitest';
import { buildKioskCheckoutFormParams, parseKioskWebhookEvent } from '../kioskStripe';

describe('buildKioskCheckoutFormParams', () => {
  const params = buildKioskCheckoutFormParams({
    items: [
      { productName: '黒×黒Tシャツ', variantLabel: 'M', unitPrice: 3500, qty: 2 },
      { productName: 'ステッカー', variantLabel: '', unitPrice: 500, qty: 1 },
    ],
    orderId: 42,
    successUrl: 'https://example.com/kiosk/done?order=42',
    cancelUrl: 'https://example.com/kiosk/cancelled',
  });

  it('金額・数量・JPYが正しく載る', () => {
    expect(params.get('line_items[0][price_data][currency]')).toBe('jpy');
    expect(params.get('line_items[0][price_data][unit_amount]')).toBe('3500');
    expect(params.get('line_items[0][quantity]')).toBe('2');
    expect(params.get('line_items[1][price_data][unit_amount]')).toBe('500');
  });

  it('サイズ付き商品は表示名にサイズが入る', () => {
    expect(params.get('line_items[0][price_data][product_data][name]')).toBe('黒×黒Tシャツ (M)');
    expect(params.get('line_items[1][price_data][product_data][name]')).toBe('ステッカー');
  });

  it('kiosk_order_id が metadata に載る(BF6のorder_idとは別キー)', () => {
    expect(params.get('metadata[kiosk_order_id]')).toBe('42');
    expect(params.get('metadata[order_id]')).toBeNull();
  });

  it('匿名運用: customer_email を要求しない', () => {
    expect(params.get('customer_email')).toBeNull();
  });

  it('payment_method_types を固定しない(ダッシュボード設定=PayPay等に追従)', () => {
    expect(params.get('payment_method_types[0]')).toBeNull();
  });
});

describe('parseKioskWebhookEvent', () => {
  const baseEvent = (metadata: Record<string, string>) => ({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: { id: 'cs_1', amount_total: 7000, currency: 'jpy', metadata } },
  });

  it('kiosk_order_id を読み取る', () => {
    const ev = parseKioskWebhookEvent(baseEvent({ kiosk_order_id: '42' }));
    expect(ev?.orderId).toBe(42);
    expect(ev?.sessionId).toBe('cs_1');
    expect(ev?.amountTotal).toBe(7000);
  });

  it('kiosk_order_id が無いイベント(BF6等)は orderId=null', () => {
    const ev = parseKioskWebhookEvent(baseEvent({ order_id: '7' }));
    expect(ev?.orderId).toBeNull();
  });

  it('壊れたイベントは null', () => {
    expect(parseKioskWebhookEvent(null)).toBeNull();
    expect(parseKioskWebhookEvent({ foo: 1 })).toBeNull();
  });
});
