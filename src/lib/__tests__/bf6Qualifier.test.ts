import { describe, it, expect } from 'vitest';
import {
  QUALIFIER_COUNT,
  hasQualifierStage,
  qualifiersReady,
  toggleQualifier,
  filterForBracketDraw,
} from '../bf6Qualifier';

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
    expect(qualifiersReady(8)).toBe(true);
    expect(qualifiersReady(7)).toBe(false);
    expect(qualifiersReady(9)).toBe(false);
  });

  it('タップで入れて、もう一度タップで外す', () => {
    const a = toggleQualifier(new Set(), 10);
    expect([...a]).toEqual([10]);
    expect([...toggleQualifier(a, 10)]).toEqual([]);
  });

  it('9人目は入らない(押し間違い防止)', () => {
    const eight = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toggleQualifier(eight, 9).size).toBe(8);
    expect(toggleQualifier(eight, 9).has(9)).toBe(false);
  });

  it('8人のときでも、既に入っている人は外せる', () => {
    const eight = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toggleQualifier(eight, 3).has(3)).toBe(false);
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
