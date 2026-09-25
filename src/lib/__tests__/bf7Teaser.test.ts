import { describe, expect, it } from 'vitest';
import { BF7_TEASER_AT, isBf7TeaserVisible } from '../bf7';

describe('isBf7TeaserVisible', () => {
  it('発表前(9/26 18:44 JST)は出さない', () => {
    expect(isBf7TeaserVisible(new Date('2026-09-26T18:44:59+09:00'))).toBe(false);
  });

  it('ちょうど18:45で出る', () => {
    expect(isBf7TeaserVisible(new Date(BF7_TEASER_AT))).toBe(true);
  });

  it('イベント後はずっと出たまま', () => {
    expect(isBf7TeaserVisible(new Date('2026-10-05T09:00:00+09:00'))).toBe(true);
  });
});
