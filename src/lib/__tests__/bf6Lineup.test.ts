import { describe, it, expect } from 'vitest';
import { lineupForBlock, CHAMPION_ORDER } from '../bf6Lineup';

const p = (itemId: number, dancerName: string, block: 'A' | 'B' | null) => ({ itemId, dancerName, block });

describe('予選の並び順', () => {
  it('エントリーが早い順(申込項目IDの昇順)で左から並べる', () => {
    const got = lineupForBlock([p(30, 'C', 'A'), p(10, 'A', 'A'), p(20, 'B', 'A')], 'A');
    expect(got.map((x) => x.dancerName)).toEqual(['A', 'B', 'C']);
  });

  it('そのブロックの人だけを並べる', () => {
    const got = lineupForBlock([p(10, 'A', 'A'), p(20, 'B', 'B'), p(30, 'C', 'A')], 'A');
    expect(got.map((x) => x.dancerName)).toEqual(['A', 'C']);
  });

  it('ブロックをまだ引いていない人は並べない(立ち位置が決まらない)', () => {
    const got = lineupForBlock([p(10, 'A', null), p(20, 'B', 'A')], 'A');
    expect(got.map((x) => x.dancerName)).toEqual(['B']);
  });

  it('誰もいなければ空', () => {
    expect(lineupForBlock([], 'A')).toEqual([]);
  });
});

describe('優勝者を並べる順番', () => {
  it('左からビギナー・小中学生・一般', () => {
    expect(CHAMPION_ORDER).toEqual(['beginner', 'kids', 'general']);
  });
});
