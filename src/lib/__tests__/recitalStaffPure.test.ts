// BW6 発表会（段階1）のスタッフの画面の純関数（Task 16）：発表会の切りかえの鍵・振り込みましたのまま3日。
import { describe, it, expect } from 'vitest';
import { pickStaffEventKey, bankToldWaitDue, parseRecitalSettings } from '../recital';
import { liveBanners } from '@/app/staff/bw6/banners';

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

describe('liveBanners（本番の帯。支払いは2つの鍵が両方そろって開く＝K224）', () => {
  const s = (o: Record<string, string>) => parseRecitalSettings(Object.entries({ suspended: '0', ...o }).map(([key, value]) => ({ key, value })));
  const NOW = Date.parse('2026-12-20T12:00:00+09:00');
  it('pay_ok_at が入っていても pay_open_at がまだ先なら「支払いは、まだ開けていません」を出す', () => {
    expect(liveBanners(s({ pay_open_at: '2026-12-25 12:00', pay_ok_at: '2026-12-14 10:00' }), NOW).payNotOpen).toBe(true);
  });
  it('両方入って時刻も過ぎていれば出さない', () => {
    expect(liveBanners(s({ pay_open_at: '2026-12-15 12:00', pay_ok_at: '2026-12-14 10:00' }), NOW).payNotOpen).toBe(false);
  });
  it('時刻は過ぎても pay_ok_at が空なら出す／止めたままの帯は suspended のとおり', () => {
    expect(liveBanners(s({ pay_open_at: '2026-12-15 12:00', pay_ok_at: '' }), NOW).payNotOpen).toBe(true);
    expect(liveBanners(s({ suspended: '1' }), NOW).suspended).toBe(true);
    expect(liveBanners(s({}), NOW).suspended).toBe(false);
  });
});
