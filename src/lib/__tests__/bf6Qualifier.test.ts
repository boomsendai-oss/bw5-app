import { describe, it, expect } from 'vitest';
import { QUALIFIER_COUNT, hasQualifierStage, qualifiersReadyFor, toggleQualifierFor, filterForBracketDraw, qualifierPickErrorFor } from '../bf6Qualifier';

describe('予選がある部門', () => {
  it('小中・一般にはある。ビギナーには無い(受付でトーナメント位置まで決まる)', () => {
    expect(hasQualifierStage('kids')).toBe(true);
    expect(hasQualifierStage('general')).toBe(true);
    expect(hasQualifierStage('beginner')).toBe(false);
  });
});

describe('通過者の選択', () => {
  it('ちょうど8名でくじ引き②に進める', () => {
    expect(QUALIFIER_COUNT).toBe(8);
    expect(qualifiersReadyFor('kids', 8)).toBe(true);
    expect(qualifiersReadyFor('kids', 7)).toBe(false);
    expect(qualifiersReadyFor('kids', 9)).toBe(false);
  });

  it('タップで入れて、もう一度タップで外す', () => {
    const a = toggleQualifierFor('kids', new Set(), 10);
    expect([...a]).toEqual([10]);
    expect([...toggleQualifierFor('kids', a, 10)]).toEqual([]);
  });

  it('9人目は入らない(押し間違い防止)', () => {
    const eight = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toggleQualifierFor('kids', eight, 9).size).toBe(8);
    expect(toggleQualifierFor('kids', eight, 9).has(9)).toBe(false);
  });

  it('8人のときでも、既に入っている人は外せる', () => {
    const eight = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toggleQualifierFor('kids', eight, 3).has(3)).toBe(false);
  });
});

describe('くじ引き②の対象者', () => {
  const entrants = [
    { itemId: 1, divisions: ['kids'] },
    { itemId: 2, divisions: ['kids'] },
    { itemId: 3, divisions: ['general', 'kids'] },
    { itemId: 4, divisions: ['beginner'] },
    { itemId: 5, divisions: ['beginner', 'kids'] },
  ];

  it('通過者としてチェックされた人だけが残る', () => {
    const out = filterForBracketDraw(entrants, { kids: new Set([1, 3]), general: new Set() });
    expect(out.map((e) => e.itemId)).toEqual([1, 3]);
  });

  it('2部門の人は、通過した部門だけが残る', () => {
    const out = filterForBracketDraw(entrants, { kids: new Set([3]), general: new Set([3]) });
    expect(out[0].divisions).toEqual(['general', 'kids']);
    const only = filterForBracketDraw(entrants, { kids: new Set([3]), general: new Set() });
    expect(only[0].divisions).toEqual(['kids']);
  });

  it('ビギナーは対象外(通過者チェックが無い)', () => {
    const out = filterForBracketDraw(entrants, { kids: new Set([5]), general: new Set() });
    expect(out.map((e) => e.itemId)).toEqual([5]);
    expect(out[0].divisions).toEqual(['kids']);
  });

  it('誰もチェックされていなければ空', () => {
    expect(filterForBracketDraw(entrants, {})).toEqual([]);
  });
});

describe('ブロックごとの上限', () => {
  // A/Bに分けて予選をやる部門は、片方から枠の半分より多くは選ばせない(TARO 2026-09-14)。
  // 上限の数は部門ごと(bf6Format の bracketSize の半分)。いまの小中は各4名。
  it('同じブロックから5人目は選べない', () => {
    expect(qualifierPickErrorFor('kids', ['A', 'A', 'A', 'A'], 'A')).toContain('4名');
  });
  it('4人目までは選べる', () => {
    expect(qualifierPickErrorFor('kids', ['A', 'A', 'A'], 'A')).toBeNull();
  });
  it('もう片方のブロックは別に数える', () => {
    expect(qualifierPickErrorFor('kids', ['A', 'A', 'A', 'A'], 'B')).toBeNull();
  });
  it('ブロックが未定の人は上限の対象外', () => {
    expect(qualifierPickErrorFor('kids', ['A', 'A', 'A', 'A'], null)).toBeNull();
  });
  it('合計を超えることはできない', () => {
    const eight = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'] as ('A' | 'B')[];
    expect(qualifierPickErrorFor('kids', eight, 'B')).toContain('8名');
  });
});
;
