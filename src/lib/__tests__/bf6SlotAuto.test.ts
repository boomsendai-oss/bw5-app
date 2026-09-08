import { describe, it, expect } from 'vitest';
import { slotsToAdd } from '../bf6Draw';

describe('くじの本数の自動調整', () => {
  it('エントリーが増えたら、足りないぶんだけ足す', () => {
    expect(slotsToAdd({ division: 'kids', phase: 'block', entrantCount: 28, existing: 25 })).toBe(3);
  });

  it('足りていれば何も足さない', () => {
    expect(slotsToAdd({ division: 'kids', phase: 'block', entrantCount: 25, existing: 25 })).toBe(0);
  });

  it('キャンセルで減っても、くじは減らさない(引いた人の番号が変わってしまうため)', () => {
    expect(slotsToAdd({ division: 'kids', phase: 'block', entrantCount: 20, existing: 25 })).toBe(0);
  });

  it('ビギナーは常に16本(トーナメントの形が決まっているため)', () => {
    expect(slotsToAdd({ division: 'beginner', phase: 'bracket', entrantCount: 12, existing: 0 })).toBe(16);
    expect(slotsToAdd({ division: 'beginner', phase: 'bracket', entrantCount: 16, existing: 16 })).toBe(0);
  });

  it('予選後のベスト8は常に8本', () => {
    expect(slotsToAdd({ division: 'kids', phase: 'bracket', entrantCount: 25, existing: 0 })).toBe(8);
    expect(slotsToAdd({ division: 'general', phase: 'bracket', entrantCount: 11, existing: 8 })).toBe(0);
  });

  it('まだ誰もエントリーしていなければ作らない', () => {
    expect(slotsToAdd({ division: 'general', phase: 'block', entrantCount: 0, existing: 0 })).toBe(0);
  });
});
