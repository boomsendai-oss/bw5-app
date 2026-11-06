// Stripe の銀行振込の有効化(本人確認の審査)の見張り: 状態が変わったときだけ知らせる。
import { describe, it, expect } from 'vitest';
import { decideBankTransferNotice } from '../stripeBankTransferWatch';

describe('decideBankTransferNotice', () => {
  it('使えるようになったら1回だけ知らせる', () => {
    const acc = { capabilities: { jp_bank_transfer_payments: 'active' } };
    expect(decideBankTransferNotice(acc, '')).toMatchObject({ notify: true, state: 'active' });
    expect(decideBankTransferNotice(acc, 'action_needed')).toMatchObject({ notify: true, state: 'active' });
    expect(decideBankTransferNotice(acc, 'active')).toEqual({ notify: false });
  });

  it('審査中で対応待ちの項目が無ければ知らせない', () => {
    expect(decideBankTransferNotice({ capabilities: { jp_bank_transfer_payments: 'pending' }, requirements: { currently_due: [], past_due: [] } }, '')).toEqual({ notify: false });
  });

  it('対応待ちの項目があれば1回だけ知らせる', () => {
    const acc = { capabilities: { jp_bank_transfer_payments: 'inactive' }, requirements: { currently_due: ['individual.verification.document'] } };
    expect(decideBankTransferNotice(acc, '')).toMatchObject({ notify: true, state: 'action_needed' });
    expect(decideBankTransferNotice(acc, 'action_needed')).toEqual({ notify: false });
  });
});
