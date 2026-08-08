import { describe, it, expect } from 'vitest';
import {
  getPlanChangeTiming,
  addMonths,
  formatMonthLabel,
  formatDayLabel,
} from '../planChangeDeadline';

/** JSTの指定日時をDateで作る（UTC-9時間） */
function jst(y: number, m: number, d: number, h = 12): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 9));
}

describe('getPlanChangeTiming', () => {
  it('締切前: 8/8 は「あと2日、9月分から」', () => {
    const t = getPlanChangeTiming(jst(2026, 8, 8));
    expect(t.today).toBe('2026-08-08');
    expect(t.deadline).toBe('2026-08-10');
    expect(t.inTime).toBe(true);
    expect(t.daysLeft).toBe(2);
    expect(t.effectiveMonth).toBe('2026-09');
    expect(t.missedMonth).toBe('2026-10');
  });

  it('締切当日(10日)はまだ間に合う: あと0日・翌月適用', () => {
    const t = getPlanChangeTiming(jst(2026, 8, 10));
    expect(t.inTime).toBe(true);
    expect(t.daysLeft).toBe(0);
    expect(t.effectiveMonth).toBe('2026-09');
  });

  it('締切翌日(11日)は翌々月適用に落ちる', () => {
    const t = getPlanChangeTiming(jst(2026, 8, 11));
    expect(t.inTime).toBe(false);
    expect(t.daysLeft).toBeNull();
    expect(t.effectiveMonth).toBe('2026-10');
  });

  it('月初(1日)はあと9日', () => {
    expect(getPlanChangeTiming(jst(2026, 8, 1)).daysLeft).toBe(9);
  });

  it('月末(8/31)は翌々月適用', () => {
    expect(getPlanChangeTiming(jst(2026, 8, 31)).effectiveMonth).toBe('2026-10');
  });

  it('年跨ぎ: 12/5 は翌年1月分から', () => {
    const t = getPlanChangeTiming(jst(2026, 12, 5));
    expect(t.inTime).toBe(true);
    expect(t.effectiveMonth).toBe('2027-01');
    expect(t.missedMonth).toBe('2027-02');
  });

  it('年跨ぎ: 12/15 は翌年2月分から', () => {
    expect(getPlanChangeTiming(jst(2026, 12, 15)).effectiveMonth).toBe('2027-02');
  });

  it('年跨ぎ: 11/30 は翌年1月分から', () => {
    expect(getPlanChangeTiming(jst(2026, 11, 30)).effectiveMonth).toBe('2027-01');
  });

  it('うるう年 2/29 は4月分から', () => {
    const t = getPlanChangeTiming(jst(2024, 2, 29));
    expect(t.today).toBe('2024-02-29');
    expect(t.inTime).toBe(false);
    expect(t.effectiveMonth).toBe('2024-04');
  });

  it('うるう年 2/10 は締切当日で3月分から', () => {
    const t = getPlanChangeTiming(jst(2024, 2, 10));
    expect(t.inTime).toBe(true);
    expect(t.effectiveMonth).toBe('2024-03');
  });

  // JST境界: Vercel(UTC)で素のDateを使うと1日ズレて締切判定が反転する事故のガード
  it('JST 8/11 の午前0時台は「11日」として扱う(UTCでは8/10)', () => {
    const t = getPlanChangeTiming(jst(2026, 8, 11, 0));
    expect(t.today).toBe('2026-08-11');
    expect(t.inTime).toBe(false);
  });

  it('JST 8/10 の23時台は「10日」として扱う(UTCでは8/10)', () => {
    const t = getPlanChangeTiming(jst(2026, 8, 10, 23));
    expect(t.today).toBe('2026-08-10');
    expect(t.inTime).toBe(true);
  });
});

describe('addMonths', () => {
  it('年内', () => expect(addMonths('2026-08', 1)).toBe('2026-09'));
  it('12月→翌年1月', () => expect(addMonths('2026-12', 1)).toBe('2027-01'));
  it('12月+2→翌年2月', () => expect(addMonths('2026-12', 2)).toBe('2027-02'));
  it('0ヶ月', () => expect(addMonths('2026-01', 0)).toBe('2026-01'));
});

describe('formatMonthLabel', () => {
  it('同年は月だけ', () => expect(formatMonthLabel('2026-09', '2026-08')).toBe('9月'));
  it('年跨ぎは年を添える', () => expect(formatMonthLabel('2027-01', '2026-12')).toBe('2027年1月'));
});

describe('formatDayLabel', () => {
  it('ゼロ埋めを外す', () => expect(formatDayLabel('2026-08-10')).toBe('8月10日'));
});
