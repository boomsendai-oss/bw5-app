import { describe, it, expect } from 'vitest';
import { calcBreakEven, calcEventProfit } from '../eventBreakEven';

// 2026-09-05 SHOKO ブレイキンWS(GOAT 13:30-15:00 / 参加費¥2,000 / ギャラ¥15,000)
const SHOKO_WS = {
  fixedCosts: [{ label: 'SHOKO ギャラ', amount: 15000 }],
  venue: { hourlyRate: 3000, hours: 1.5 }, // studios.hourly_rate の実値
  feePerPerson: 2000,
};

describe('calcBreakEven', () => {
  it('SHOKO WSの損益分岐は10名（Claudeが概算で8名と誤答した件の回帰テスト）', () => {
    const r = calcBreakEven(SHOKO_WS);
    expect(r.totalFixed).toBe(19500); // ¥15,000 + ¥4,500
    expect(r.breakEvenCount).toBe(10); // 19500/2000 = 9.75 → 10
  });

  it('9.75人を9人に切り捨てない（切り捨てると赤字のまま黒字と誤報する）', () => {
    const r = calcBreakEven(SHOKO_WS);
    expect(calcEventProfit(SHOKO_WS, r.breakEvenCount - 1)).toBeLessThan(0);
    expect(calcEventProfit(SHOKO_WS, r.breakEvenCount)).toBeGreaterThanOrEqual(0);
  });

  it('1.5時間のような端数時間を正しく掛ける', () => {
    const r = calcBreakEven(SHOKO_WS);
    expect(r.lines.find((l) => l.label.startsWith('会場費'))?.amount).toBe(4500);
  });

  it('満席15名なら+¥10,500', () => {
    expect(calcEventProfit(SHOKO_WS, 15)).toBe(10500);
  });

  it('現在5名なら−¥9,500', () => {
    expect(calcEventProfit(SHOKO_WS, 5)).toBe(-9500);
  });

  it('会場が実費(公共施設)なら固定額で計算できる', () => {
    const r = calcBreakEven({
      fixedCosts: [{ label: 'ギャラ', amount: 10000 }],
      venue: { flat: 1040 },
      feePerPerson: 1000,
    });
    expect(r.totalFixed).toBe(11040);
    expect(r.breakEvenCount).toBe(12);
  });

  it('会場費なし(自社スタジオ)でも計算できる', () => {
    const r = calcBreakEven({ fixedCosts: [{ label: 'ギャラ', amount: 15000 }], feePerPerson: 3000 });
    expect(r.totalFixed).toBe(15000);
    expect(r.breakEvenCount).toBe(5);
  });

  it('1人あたり変動費を引いた粗利で割る', () => {
    const r = calcBreakEven({
      fixedCosts: [{ label: 'ギャラ', amount: 10000 }],
      feePerPerson: 2000,
      variableCostPerPerson: 500,
    });
    expect(r.marginPerPerson).toBe(1500);
    expect(r.breakEvenCount).toBe(7); // 10000/1500 = 6.67 → 7
  });

  it('参加費より1人あたりコストが高いと何人来ても回収できない', () => {
    const r = calcBreakEven({
      fixedCosts: [{ label: 'ギャラ', amount: 10000 }],
      feePerPerson: 1000,
      variableCostPerPerson: 1200,
    });
    expect(r.breakEvenCount).toBe(Infinity);
  });

  it('ちょうど割り切れるときは切り上げない', () => {
    const r = calcBreakEven({ fixedCosts: [{ label: 'ギャラ', amount: 20000 }], feePerPerson: 2000 });
    expect(r.breakEvenCount).toBe(10);
  });
});
