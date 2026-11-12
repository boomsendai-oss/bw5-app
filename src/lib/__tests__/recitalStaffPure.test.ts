// BW6 発表会（段階1）のスタッフの画面の純関数（Task 16）：発表会の切りかえの鍵・振り込みましたのまま3日。
import { describe, it, expect } from 'vitest';
import { pickStaffEventKey, bankToldWaitDue } from '../recital';

describe('pickStaffEventKey', () => {
  it('決まった3つだけ通し、ほかは本番', () => {
    expect(pickStaffEventKey(undefined)).toBe('bw6');
    expect(pickStaffEventKey('bw6-test')).toBe('bw6-test');
    expect(pickStaffEventKey('bw6-smoke')).toBe('bw6-smoke');
    expect(pickStaffEventKey('t-x')).toBe('bw6');
    expect(pickStaffEventKey('BW6-TEST')).toBe('bw6');
  });
});

describe('bankToldWaitDue（振り込みましたのまま3日。休みの間は数えない。JST の日付で数える）', () => {
  const R = ['2026-12-30', '2027-01-03'] as const;
  const at = (s: string) => Date.parse(s);
  it('2/5（金）に押した → 2/7 はまだ・2/8（月）の朝に出る', () => {
    expect(bankToldWaitDue('2027-02-05T01:00:00.000Z', at('2027-02-07T23:59:00+09:00'), ...R)).toBe(false);
    expect(bankToldWaitDue('2027-02-05T01:00:00.000Z', at('2027-02-08T00:00:00+09:00'), ...R)).toBe(true);
  });
  it('12/29 に押した → 12/30〜1/3 は数えず、1/6 に出る', () => {
    expect(bankToldWaitDue('2026-12-29T03:00:00.000Z', at('2027-01-05T12:00:00+09:00'), ...R)).toBe(false);
    expect(bankToldWaitDue('2026-12-29T03:00:00.000Z', at('2027-01-06T08:00:00+09:00'), ...R)).toBe(true);
  });
  it('JST 2/5 01:00（UTC では 2/4）に押した日は 2/5 と数える', () => {
    expect(bankToldWaitDue('2027-02-04T16:00:00.000Z', at('2027-02-07T12:00:00+09:00'), ...R)).toBe(false);
    expect(bankToldWaitDue('2027-02-04T16:00:00.000Z', at('2027-02-08T00:00:00+09:00'), ...R)).toBe(true);
  });
});
