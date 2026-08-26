import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendEmail = vi.fn();
vi.mock('@/lib/email', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));
vi.mock('@/lib/email.ts', () => ({ sendEmail: (...a: unknown[]) => sendEmail(...a) }));

const { canSendMail, buildCancelMailTarget } = await import('../bf6CancelSend');

beforeEach(() => sendEmail.mockReset());

describe('メール送信が可能かどうかの事前チェック', () => {
  it('認証情報が無いときは false(黙って成功にしない)', () => {
    expect(canSendMail(undefined)).toBe(false);
    expect(canSendMail('')).toBe(false);
  });

  it('認証情報があるときだけ true', () => {
    expect(canSendMail('abcd efgh ijkl mnop')).toBe(true);
  });
});

describe('注文からキャンセルメールの宛先と内容を組み立てる', () => {
  const order = {
    orderId: 10,
    buyerName: '若生みゅう',
    email: 'someone@example.com',
    payMethod: 'prepaid' as const,
    paymentStatus: 'refunded',
    amountTotal: 2000,
    items: [
      { itemType: 'entry', dancerName: 'MYU', divisions: ['general'] },
      { itemType: 'ticket_adult', dancerName: '', divisions: [] },
    ],
  };

  it('バトルエントリーの出場者名と部門だけを拾う', () => {
    const t = buildCancelMailTarget(order);
    expect(t.to).toBe('someone@example.com');
    expect(t.input.dancerNames).toEqual(['MYU']);
    expect(t.input.divisionLabels).toEqual(['一般部門']);
  });

  it('返金額は注文金額を使う(返金済みでも金額を出す)', () => {
    const t = buildCancelMailTarget(order);
    expect(t.input.refundAmount).toBe(2000);
  });

  it('当日現金の注文は返金額0で組み立てる', () => {
    const t = buildCancelMailTarget({ ...order, payMethod: 'onsite' });
    expect(t.input.refundAmount).toBe(0);
  });

  it('同じ部門が複数人にまたがっても部門名は重複させない', () => {
    const t = buildCancelMailTarget({
      ...order,
      items: [
        { itemType: 'entry', dancerName: 'MYU', divisions: ['general'] },
        { itemType: 'entry', dancerName: 'AOI', divisions: ['general'] },
      ],
    });
    expect(t.input.dancerNames).toEqual(['MYU', 'AOI']);
    expect(t.input.divisionLabels).toEqual(['一般部門']);
  });
});
