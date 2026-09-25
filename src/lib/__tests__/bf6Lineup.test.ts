import { describe, it, expect } from 'vitest';
import { lineupForBlock, CHAMPION_ORDER } from '../bf6Lineup';

const p = (
  itemId: number,
  dancerName: string,
  block: 'A' | 'B' | null,
  drawnAt: string | null = null
) => ({ itemId, dancerName, block, drawnAt });

describe('予選の並び順', () => {
  it('当日その場で受付した順(くじ引き①の時刻)で左から並べる', () => {
    // 申込が早い順にすると受付のたびに間に割り込み、紙に書き写せない(TARO 2026-09-25)
    const got = lineupForBlock(
      [
        p(10, '申込1番', 'A', '2026-09-26T13:50:00Z'),
        p(30, '申込3番', 'A', '2026-09-26T13:35:00Z'),
        p(20, '申込2番', 'A', '2026-09-26T13:42:00Z'),
      ],
      'A'
    );
    expect(got.map((x) => x.dancerName)).toEqual(['申込3番', '申込2番', '申込1番']);
  });

  it('あとから受付した人は右端に足されるだけ(すでに書き写した並びが崩れない)', () => {
    const first = [
      p(10, 'A', 'A', '2026-09-26T13:31:00Z'),
      p(20, 'B', 'A', '2026-09-26T13:33:00Z'),
    ];
    const later = [...first, p(30, 'C', 'A', '2026-09-26T13:40:00Z')];
    expect(lineupForBlock(later, 'A').map((x) => x.dancerName)).toEqual(['A', 'B', 'C']);
  });

  it('時刻が同じ(または無い)ときは申込項目IDで決める', () => {
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
  it('左からビギナー・一般・小中学生(会場で決勝の2人が並ぶ位置と同じ)', () => {
    // TARO 2026-09-22: ステージの左にビギナー、真ん中に一般、右に小中学生の決勝2人を並べ、
    // 間に立ったジャッジが「3・2・1・ジャッジ」で3部門同時に勝者の手を上げる。LEDも同じ並びにする。
    expect(CHAMPION_ORDER).toEqual(['beginner', 'general', 'kids']);
  });
});
