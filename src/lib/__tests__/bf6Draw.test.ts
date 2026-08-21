import { describe, it, expect } from 'vitest';
import {
  blockOfSlot,
  bracketPairs,
  drawUnitsForEntry,
  slotCountFor,
  nextMatchIndex,
  type BracketMatch,
} from '../bf6Draw';

describe('抽選の単位', () => {
  it('1部門のエントリーは1枠', () => {
    expect(drawUnitsForEntry(10, ['beginner'])).toEqual([{ itemId: 10, division: 'beginner' }]);
  });

  it('複数部門のエントリーは部門ごとに枠を持つ(実際に5名いる)', () => {
    expect(drawUnitsForEntry(11, ['kids', 'general'])).toEqual([
      { itemId: 11, division: 'kids' },
      { itemId: 11, division: 'general' },
    ]);
  });
});

describe('スロット数', () => {
  it('ビギナーは常に16(欠員はBYEになる)', () => {
    expect(slotCountFor('beginner', 'bracket', 15)).toBe(16);
    expect(slotCountFor('beginner', 'bracket', 16)).toBe(16);
  });

  it('小中・一般の一次予選ブロックは実エントリー数ぶん', () => {
    expect(slotCountFor('kids', 'block', 17)).toBe(17);
    expect(slotCountFor('general', 'block', 9)).toBe(9);
  });

  it('小中・一般のベスト8トーナメントは常に8', () => {
    expect(slotCountFor('kids', 'bracket', 8)).toBe(8);
  });
});

describe('A/Bブロックの振り分け', () => {
  it('前半がA・後半がB', () => {
    expect(blockOfSlot(1, 8)).toBe('A');
    expect(blockOfSlot(4, 8)).toBe('A');
    expect(blockOfSlot(5, 8)).toBe('B');
    expect(blockOfSlot(8, 8)).toBe('B');
  });

  it('奇数人数ならAが1人多い', () => {
    expect(blockOfSlot(5, 9)).toBe('A');
    expect(blockOfSlot(6, 9)).toBe('B');
  });
});

describe('トーナメントの組み合わせ', () => {
  it('16枠なら8試合、隣どうしが対戦', () => {
    const p = bracketPairs(16);
    expect(p).toHaveLength(8);
    expect(p[0]).toEqual([1, 2]);
    expect(p[7]).toEqual([15, 16]);
  });

  it('8枠なら4試合', () => {
    expect(bracketPairs(8)).toEqual([[1, 2], [3, 4], [5, 6], [7, 8]]);
  });
});

describe('次の試合', () => {
  const m = (winner: number | null): BracketMatch => ({ slotA: 1, slotB: 2, winnerSlot: winner });

  it('未決着のいちばん若い試合が次', () => {
    expect(nextMatchIndex([m(1), m(null), m(null)])).toBe(1);
  });

  it('全部決まっていれば null', () => {
    expect(nextMatchIndex([m(1), m(2)])).toBeNull();
  });
});
