import { describe, it, expect } from 'vitest';
import { arcPositions, lineupForBlock, CHAMPION_ORDER } from '../bf6Lineup';

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

describe('半円の位置', () => {
  it('人数ぶんの位置を返す', () => {
    expect(arcPositions(5)).toHaveLength(5);
  });

  it('1番目が一番左、最後が一番右', () => {
    const a = arcPositions(7);
    expect(a[0].leftPct).toBeLessThan(a[3].leftPct);
    expect(a[3].leftPct).toBeLessThan(a[6].leftPct);
  });

  it('左から右へ、追い越さずに並ぶ', () => {
    const a = arcPositions(13);
    for (let i = 1; i < a.length; i += 1) {
      expect(a[i].leftPct).toBeGreaterThan(a[i - 1].leftPct);
    }
  });

  it('真ん中がいちばん高い(半円の形になる)', () => {
    const a = arcPositions(5);
    expect(a[2].topPct).toBeLessThan(a[0].topPct);
    expect(a[2].topPct).toBeLessThan(a[4].topPct);
  });

  it('両端の高さは同じ', () => {
    const a = arcPositions(9);
    expect(a[0].topPct).toBeCloseTo(a[8].topPct, 5);
  });

  it('1人なら真ん中に置く(0で割らない)', () => {
    const a = arcPositions(1);
    expect(a).toHaveLength(1);
    expect(a[0].leftPct).toBeCloseTo(50, 5);
  });

  it('0人なら空', () => {
    expect(arcPositions(0)).toEqual([]);
  });

  it('画面の外にはみ出さない', () => {
    for (const n of [1, 2, 5, 13, 16]) {
      for (const q of arcPositions(n)) {
        expect(q.leftPct).toBeGreaterThanOrEqual(0);
        expect(q.leftPct).toBeLessThanOrEqual(100);
        expect(q.topPct).toBeGreaterThanOrEqual(0);
        expect(q.topPct).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('優勝者を並べる順番', () => {
  it('左からビギナー・小中学生・一般', () => {
    expect(CHAMPION_ORDER).toEqual(['beginner', 'kids', 'general']);
  });
});
