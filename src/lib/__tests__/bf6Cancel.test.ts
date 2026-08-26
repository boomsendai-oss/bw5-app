import { describe, it, expect } from 'vitest';
import { requiresSlotRelease, refundState, CANCEL_STATUSES } from '../bf6Cancel';

describe('キャンセル時に抽選枠を解放すべきか', () => {
  it('キャンセル・返金済みは解放する', () => {
    expect(requiresSlotRelease('canceled')).toBe(true);
    expect(requiresSlotRelease('refunded')).toBe(true);
  });

  it('入金済み・当日現金・決済待ちは解放しない(枠を持ったままの正常な状態)', () => {
    expect(requiresSlotRelease('paid')).toBe(false);
    expect(requiresSlotRelease('cash_due')).toBe(false);
    expect(requiresSlotRelease('pending')).toBe(false);
  });

  it('期限切れは解放しない(そもそも枠を持っていない)', () => {
    expect(requiresSlotRelease('expired')).toBe(false);
  });

  it('CANCEL_STATUSES と requiresSlotRelease の判定が一致する', () => {
    for (const s of CANCEL_STATUSES) expect(requiresSlotRelease(s)).toBe(true);
  });
});

describe('返金が必要かどうかの判定', () => {
  const prepaid = { payMethod: 'prepaid' as const, amountTotal: 2000 };
  const onsite = { payMethod: 'onsite' as const, amountTotal: 2500 };

  it('事前カード決済をキャンセルしたら「返金未処理」になる', () => {
    const r = refundState({ ...prepaid, paymentStatus: 'canceled' });
    expect(r.kind).toBe('due');
    expect(r.amount).toBe(2000);
  });

  it('返金済みにしたら「返金済み」になり、金額は請求しない', () => {
    const r = refundState({ ...prepaid, paymentStatus: 'refunded' });
    expect(r.kind).toBe('done');
    expect(r.amount).toBe(0);
  });

  it('当日現金のキャンセルは返金不要(まだ受け取っていない)', () => {
    const r = refundState({ ...onsite, paymentStatus: 'canceled' });
    expect(r.kind).toBe('none');
    expect(r.amount).toBe(0);
  });

  it('キャンセルしていない注文は返金の対象外', () => {
    expect(refundState({ ...prepaid, paymentStatus: 'paid' }).kind).toBe('none');
    expect(refundState({ ...onsite, paymentStatus: 'cash_due' }).kind).toBe('none');
  });

  it('決済まで到達していない注文(決済待ち・期限切れ)は返金不要', () => {
    expect(refundState({ ...prepaid, paymentStatus: 'pending' }).kind).toBe('none');
    expect(refundState({ ...prepaid, paymentStatus: 'expired' }).kind).toBe('none');
  });

  it('金額0(SSM学生枠など無料)の事前決済キャンセルは返金不要', () => {
    const r = refundState({ payMethod: 'prepaid', amountTotal: 0, paymentStatus: 'canceled' });
    expect(r.kind).toBe('none');
  });
});
