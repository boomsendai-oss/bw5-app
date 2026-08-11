import { describe, expect, it } from 'vitest';
import { expandRecurringDates } from '../storyDayPlan';

describe('expandRecurringDates (繰り返し予約の対象日展開)', () => {
  // 2026-08-12は水曜。翌日(木)から終了日まで。
  it('毎週金曜・9/26まで → 金曜だけが並ぶ', () => {
    expect(expandRecurringDates([5], '2026-08-12', '2026-09-26')).toEqual([
      '2026-08-14', '2026-08-21', '2026-08-28', '2026-09-04', '2026-09-11', '2026-09-18', '2026-09-25',
    ]);
  });

  it('火・金の複数曜日も日付順に混ざる', () => {
    expect(expandRecurringDates([2, 5], '2026-08-12', '2026-08-22')).toEqual([
      '2026-08-14', '2026-08-18', '2026-08-21',
    ]);
  });

  it('終了日当日も曜日が合えば含む', () => {
    expect(expandRecurringDates([6], '2026-08-12', '2026-08-15')).toEqual(['2026-08-15']);
  });

  it('今日は含まない(明日から)', () => {
    expect(expandRecurringDates([3], '2026-08-12', '2026-08-12')).toEqual([]);
  });

  it('90日で打ち切る(無限予約の防止)', () => {
    const out = expandRecurringDates([0, 1, 2, 3, 4, 5, 6], '2026-08-12', '2027-08-12');
    expect(out).toHaveLength(90);
    expect(out[0]).toBe('2026-08-13');
  });

  it('曜日が空・日付が不正なら空配列', () => {
    expect(expandRecurringDates([], '2026-08-12', '2026-09-26')).toEqual([]);
    expect(expandRecurringDates([5], 'ぐちゃぐちゃ', '2026-09-26')).toEqual([]);
  });
});
