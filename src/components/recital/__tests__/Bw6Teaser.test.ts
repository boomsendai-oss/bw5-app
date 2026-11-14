import { describe, expect, it } from 'vitest';
import { BW6_TEASER, jpMonthDay, mocchinOpenForTeaser } from '../Bw6Teaser';

describe('Bw6Teaser', () => {
  it('モッチンさんナンバーの案内は、会員の先行期間から締切の日まで出す', () => {
    expect(mocchinOpenForTeaser('2026-11-07')).toBe(false);
    expect(mocchinOpenForTeaser('2026-11-08')).toBe(true);
    expect(mocchinOpenForTeaser('2026-11-15')).toBe(true);
    expect(mocchinOpenForTeaser('2026-12-13')).toBe(true);
    expect(mocchinOpenForTeaser('2026-12-14')).toBe(false);
  });
  it('日付の書き方と曜日', () => {
    expect(jpMonthDay('2026-12-13')).toBe('12月13日(日)');
    expect(jpMonthDay('2026-12-15')).toBe('12月15日(火)');
    expect(BW6_TEASER.entryOpen).toBe(jpMonthDay('2026-12-15'));
    expect(BW6_TEASER.date).toBe('2027年4月11日(日)');
  });
});
