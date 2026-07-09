import { describe, it, expect } from 'vitest';
import { cheapestCover } from '../studioBilling';

type Block = { label: string; start: string; end: string; price: number };
const m = (h: number, mi = 0) => h * 60 + mi;

// M6: 複数区分またぎの最安被覆(合算)
describe('cheapestCover (M6)', () => {
  // 分離区分のみ(合成区分なし)のスタジオを想定
  const disjoint: Block[] = [
    { label: '午前', start: '09:00', end: '12:00', price: 900 },
    { label: '午後', start: '12:00', end: '17:00', price: 1100 },
    { label: '夜間', start: '17:00', end: '22:00', price: 1100 },
  ];

  it('午前+午後にまたがる → 2区分を合算(¥2000)', () => {
    const r = cheapestCover(disjoint, m(10), m(16));
    expect(r).toEqual({ price: 2000, labels: ['午前', '午後'] });
  });

  it('3区分にまたがる → 全部合算(¥3100)', () => {
    const r = cheapestCover(disjoint, m(10), m(21));
    expect(r?.price).toBe(3100);
    expect(r?.labels).toEqual(['午前', '午後', '夜間']);
  });

  it('隙間があってカバー不能なら null', () => {
    const gapped: Block[] = [
      { label: '午前', start: '09:00', end: '11:00', price: 900 },
      { label: '午後', start: '13:00', end: '17:00', price: 1100 }, // 11-13が隙間
    ];
    expect(cheapestCover(gapped, m(10), m(15))).toBeNull();
  });

  it('全区分の範囲外(早すぎる開始)なら null', () => {
    expect(cheapestCover(disjoint, m(7), m(10))).toBeNull();
  });

  it('同じ終端なら安い方を選ぶ', () => {
    const overlap: Block[] = [
      { label: '安', start: '09:00', end: '17:00', price: 1500 },
      { label: '高', start: '09:00', end: '17:00', price: 3000 },
    ];
    expect(cheapestCover(overlap, m(9), m(17))?.price).toBe(1500);
  });
});
