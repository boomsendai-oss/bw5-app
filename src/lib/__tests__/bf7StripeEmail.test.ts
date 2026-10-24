import { describe, it, expect } from 'vitest';
import { buildBf7CheckoutFormParams, parseBf7WebhookEvent } from '../bf7Stripe';
import { parseBf6WebhookEvent } from '../bf6Stripe';
import { buildBf7OrderEmail } from '../bf7Email';
import type { OwnBf7Order } from '../bf7EntryDb';

describe('vol.7の決済をvol.6と取り違えない', () => {
  it('決済ページには bf7_order_id だけを入れる(order_id は入れない)', () => {
    const p = buildBf7CheckoutFormParams({ lineItems: [{ name: 'x', unitAmount: 100, qty: 1 }], successUrl: 's', cancelUrl: 'c', customerEmail: 'a@b.c', orderId: 12 });
    expect(p.get('metadata[bf7_order_id]')).toBe('12');
    expect(p.get('metadata[order_id]')).toBeNull();
  });
  it('vol.7の通知はvol.7として読み、vol.6側は注文番号を拾わない', () => {
    const ev = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_1', metadata: { bf7_order_id: '12' }, amount_total: 5000, currency: 'jpy' } } };
    expect(parseBf7WebhookEvent(ev)?.orderId).toBe(12);
    expect(parseBf6WebhookEvent(ev)?.orderId).toBeNull();
  });
  it('vol.6の通知はvol.7として読まない', () => {
    const ev = { id: 'evt_2', type: 'checkout.session.completed', data: { object: { id: 'cs_2', metadata: { order_id: '5' } } } };
    expect(parseBf7WebhookEvent(ev)).toBeNull();
  });
});

describe('vol.7の完了メール', () => {
  const order: OwnBf7Order = {
    orderId: 3, buyerName: '申込 太郎', email: 'a@b.c', phone: '', payMethod: 'prepaid', paymentStatus: 'paid',
    amountTotal: 5000, expiresAt: '', createdAt: '',
    items: [{ itemId: 1, itemType: 'entry', performerName: 'テスト', dancerName: 'TARO', dancerKana: 'タロー', grade: 'adult', genre: 'HIPHOP', rep: '仙台', instagram: '', isFirstBattle: false, divisions: ['general'], qty: 1, unitAmount: 2500 }],
  };
  it('件名と本文がvol.7・受付番号BF7-003・1/30開催になっている', () => {
    const m = buildBf7OrderEmail(order, 'tok');
    expect(m.subject).toContain('vol.7');
    expect(m.subject).toContain('BF7-003');
    expect(m.text).toContain('2027年1月30日(土)');
    expect(m.text).toContain('/bf7/complete?t=tok');
    expect(m.text).not.toContain('vol.6');
  });
  it('まだ決まっていない集合時刻は書かない', () => {
    expect(buildBf7OrderEmail(order, 'tok').text).not.toContain('13:30');
  });
});
