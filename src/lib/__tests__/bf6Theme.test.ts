import { describe, it, expect } from 'vitest';
import { divisionTheme, DIVISION_THEMES } from '../bf6Theme';

// LEDのトーナメント表とVSは今まで全部オレンジで、どの部門か色で分からなかった(TARO 2026-09-14)。
// 受付iPadの部門選択と同じ色に揃える(ビギナー=緑 / 小中学生=オレンジ / 一般=赤)。
describe('部門ごとのテーマ色', () => {
  it('3部門ぶんある', () => {
    expect(Object.keys(DIVISION_THEMES).sort()).toEqual(['beginner', 'general', 'kids']);
  });
  it('ビギナーは緑、小中学生はオレンジ、一般は赤', () => {
    expect(divisionTheme('beginner').name).toBe('emerald');
    expect(divisionTheme('kids').name).toBe('orange');
    expect(divisionTheme('general').name).toBe('red');
  });
  it('色は部門どうしで重ならない', () => {
    const names = Object.values(DIVISION_THEMES).map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
  it('知らない部門でも落ちない(既定はオレンジ)', () => {
    expect(divisionTheme('unknown').name).toBe('orange');
  });
  it('文字色・光の色・線の色がそろっている', () => {
    for (const t of Object.values(DIVISION_THEMES)) {
      expect(t.text).toMatch(/^text-/);
      expect(t.border).toMatch(/^border-/);
      expect(t.glow).toMatch(/^#|rgba/);
    }
  });
});
