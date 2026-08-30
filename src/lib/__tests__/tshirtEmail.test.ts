import { describe, it, expect } from 'vitest';
import { buildTshirtOrderEmail } from '../tshirtEmail';

const base = {
  name: 'ブーム 太郎',
  size: 'L' as const,
  qty: 2,
  wantsShipping: false,
  totalAmount: 7000,
  paymentMethod: 'cash' as const,
  editUrl: 'https://bw5-app.vercel.app/merch/tshirt?t=abc123',
};

describe('buildTshirtOrderEmail', () => {
  it('受付(現金): 内容と現金引き換えの案内が入る', () => {
    const m = buildTshirtOrderEmail(base, 'ordered');
    expect(m.subject).toContain('ご注文ありがとうございます');
    expect(m.text).toContain('ブーム 太郎');
    expect(m.text).toContain('Lサイズ × 2枚');
    expect(m.text).toContain('¥7,000');
    expect(m.text).toContain('現金');
    expect(m.text).toContain(base.editUrl);
  });

  it('受付(カード未払い): 決済リンクの案内が入る', () => {
    const m = buildTshirtOrderEmail({ ...base, paymentMethod: 'stripe' }, 'ordered');
    expect(m.text).toContain('お支払いがまだの場合');
    expect(m.text).toContain(base.editUrl);
  });

  it('支払い完了: 確認の件名と、現金案内が入らないこと', () => {
    const m = buildTshirtOrderEmail({ ...base, paymentMethod: 'stripe' }, 'paid');
    expect(m.subject).toContain('お支払いを確認しました');
    expect(m.text).toContain('¥7,000');
    expect(m.text).not.toContain('現金と引き換え');
  });

  it('郵送注文: 郵送の案内が入る', () => {
    const m = buildTshirtOrderEmail({ ...base, paymentMethod: 'stripe', wantsShipping: true, totalAmount: 7800 }, 'paid');
    expect(m.text).toContain('郵送');
    expect(m.text).toContain('¥7,800');
  });
});
