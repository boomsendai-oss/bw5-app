import { describe, it, expect } from 'vitest';
import { divisionsForPhase, entrantsInDivision, drawFor, drawPhaseFor, receptionTabs, wristbandLabel, type ReceptionRow } from '../bf6Reception';

// 受付・くじ引きの画面を部門のタブで切り替える(TARO 2026-09-11)。
// 全部門が1つの一覧に混ざっていると、名前を押してから部門を選ぶ手間があり、押し間違いも起きる。
const e = (itemId: number, divisions: string[], draws: ReceptionRow['draws'] = [], checkedIn = false): ReceptionRow => ({
  itemId,
  divisions,
  draws,
  checkedIn,
});

describe('タブに出す部門', () => {
  it('受付時(くじ引き①)は3部門', () => {
    expect(divisionsForPhase('block')).toEqual(['beginner', 'kids', 'general']);
  });
  it('予選後(くじ引き②)は小中と一般だけ(ビギナーは受付時に位置まで決まっている)', () => {
    expect(divisionsForPhase('bracket')).toEqual(['kids', 'general']);
  });
});

describe('部門で絞る', () => {
  const rows = [e(1, ['beginner']), e(2, ['kids', 'general']), e(3, ['general'])];
  it('その部門に出ている人だけ', () => {
    expect(entrantsInDivision(rows, 'general').map((r) => r.itemId)).toEqual([2, 3]);
  });
  it('2部門に出ている人は両方のタブに出る', () => {
    expect(entrantsInDivision(rows, 'kids').map((r) => r.itemId)).toEqual([2]);
  });
});

describe('その部門・そのくじ引きで引いた結果', () => {
  const row = e(2, ['kids', 'general'], [
    { division: 'kids', phase: 'block', slotNo: 5, block: 'A' },
    { division: 'general', phase: 'block', slotNo: 3, block: 'B' },
  ]);
  it('タブの部門の結果だけを返す(もう片方の部門の結果を混ぜない)', () => {
    expect(drawFor(row, 'general', 'block')).toMatchObject({ block: 'B' });
  });
  it('くじ引き②の画面では①の結果を返さない', () => {
    expect(drawFor(row, 'kids', 'bracket')).toBeNull();
  });
});

describe('タブの表示(引いた人数 / その部門の人数)', () => {
  const rows = [
    e(1, ['beginner'], [{ division: 'beginner', phase: 'bracket', slotNo: 4 }], true),
    e(2, ['beginner']),
    e(3, ['kids', 'general'], [{ division: 'kids', phase: 'block', slotNo: 1, block: 'A' }], true),
  ];
  it('受付時は、ビギナーは位置のくじ、小中・一般はブロックのくじを引いた人を数える', () => {
    expect(receptionTabs(rows, 'block')).toEqual([
      { division: 'beginner', label: 'ビギナー', drawn: 1, total: 2 },
      { division: 'kids', label: '小中学生', drawn: 1, total: 1 },
      { division: 'general', label: '一般', drawn: 0, total: 1 },
    ]);
  });
});

describe('実際に引くくじの種類', () => {
  // ⚠️ 受付時(①)の画面でビギナーを引くとき、画面のフェーズ(block)をそのまま使うと
  //    ビギナーにはブロックの枠が無いので「空き枠がありません」になっていた(2026-09-11)。
  it('受付時: ビギナーはトーナメント位置、小中・一般はA/Bブロック', () => {
    expect(drawPhaseFor('beginner', 'block')).toBe('bracket');
    expect(drawPhaseFor('kids', 'block')).toBe('block');
    expect(drawPhaseFor('general', 'block')).toBe('block');
  });
  it('予選後: ベスト8の位置', () => {
    expect(drawPhaseFor('kids', 'bracket')).toBe('bracket');
  });
});

describe('渡すリストバンドの呼び方', () => {
  // 小中・一般は予選ブロックごとに「小中A」「一般B」、ビギナーは「ビギナー」と書かれたものを渡す(TARO 2026-09-12)
  it('小中・一般はブロックの文字まで入れる', () => {
    expect(wristbandLabel('kids', 'A')).toBe('小中A');
    expect(wristbandLabel('general', 'B')).toBe('一般B');
  });
  it('ビギナーはブロックが無いので「ビギナー」', () => {
    expect(wristbandLabel('beginner', undefined)).toBe('ビギナー');
  });
  it('ブロックが決まっていない小中は部門名だけ', () => {
    expect(wristbandLabel('kids', undefined)).toBe('小中');
  });
});
