// 一般部門をA/B 2サークル・ベスト8にした(TARO 2026-09-25)ときに、
// 受付のくじ引き→ブロック分け→予選通過→くじ引き②→本戦 まで筋が通っているかを
// 実際の人数(18名)で通して確かめる。当日の運用そのままの順番で並べてある。
import { describe, expect, it } from 'vitest';
import { blockOfSlot, slotCountFor, slotsToAdd } from '../bf6Draw';
import { bracketSizeFor, qualifierCountFor, qualifierPerBlockFor, roundsForSize, usesBlocks } from '../bf6Format';
import { qualifierPickErrorFor } from '../bf6Qualifier';
import { drawPhaseFor, wristbandLabel } from '../bf6Reception';

const ENTRANTS = 18; // 締切時点の一般部門

describe('一般部門 A/B 2サークル(18名)', () => {
  it('受付のくじ引き①はブロックを引く(トーナメント位置ではない)', () => {
    expect(drawPhaseFor('general', 'block')).toBe('block');
    expect(slotCountFor('general', 'block', ENTRANTS)).toBe(18);
  });

  it('18本の枠が9/9でA・Bに割れる', () => {
    const blocks = Array.from({ length: ENTRANTS }, (_, i) => blockOfSlot(i + 1, ENTRANTS));
    expect(blocks.filter((b) => b === 'A')).toHaveLength(9);
    expect(blocks.filter((b) => b === 'B')).toHaveLength(9);
    expect(blockOfSlot(9, ENTRANTS)).toBe('A');
    expect(blockOfSlot(10, ENTRANTS)).toBe('B');
  });

  it('リストバンドは 一般A / 一般B', () => {
    expect(wristbandLabel('general', 'A')).toBe('一般A');
    expect(wristbandLabel('general', 'B')).toBe('一般B');
  });

  it('予選は各ブロック4名通過=合計8名', () => {
    expect(usesBlocks('general')).toBe(true);
    expect(qualifierCountFor('general')).toBe(8);
    expect(qualifierPerBlockFor('general')).toBe(4);
  });

  it('片方のブロックから5人目は選べない', () => {
    const four: ('A' | 'B')[] = ['A', 'A', 'A', 'A'];
    expect(qualifierPickErrorFor('general', four, 'A')).toContain('Aブロックは4名まで');
    expect(qualifierPickErrorFor('general', four, 'B')).toBeNull();
  });

  it('くじ引き②はベスト8の枠8本。本戦は準々決勝から', () => {
    expect(bracketSizeFor('general')).toBe(8);
    expect(slotCountFor('general', 'bracket', ENTRANTS)).toBe(8);
    expect(roundsForSize(bracketSizeFor('general'))).toEqual(['qf', 'sf', 'f']);
  });

  it('枠は足すだけで減らさない(すでに引いた番号を動かさない)', () => {
    expect(slotsToAdd({ division: 'general', phase: 'block', entrantCount: 18, existing: 18 })).toBe(0);
    expect(slotsToAdd({ division: 'general', phase: 'block', entrantCount: 17, existing: 18 })).toBe(0);
  });
});
