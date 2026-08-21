import { describe, it, expect } from 'vitest';
import {
  roundsFor, roundLabel, seedRound1, advanceRound, nextUndecided, isRoundComplete,
  type Match,
} from '../bf6Bracket';

const m = (no: number, a: number | null, b: number | null, w: number | null = null): Match =>
  ({ round: 'r16', matchNo: no, slotA: a, slotB: b, winnerSlot: w });

describe('ラウンド構成', () => {
  it('ビギナーはベスト16から', () => {
    expect(roundsFor('beginner')).toEqual(['r16', 'qf', 'sf', 'f']);
  });
  it('小中・一般はベスト8から(予選で8名に絞るため)', () => {
    expect(roundsFor('kids')).toEqual(['qf', 'sf', 'f']);
    expect(roundsFor('general')).toEqual(['qf', 'sf', 'f']);
  });
  it('ラウンド名は日本語で出す', () => {
    expect(roundLabel('r16')).toBe('ベスト16');
    expect(roundLabel('f')).toBe('決勝');
  });
});

describe('1回戦の生成', () => {
  it('16枠なら8試合、隣どうし', () => {
    const r = seedRound1('beginner', 16);
    expect(r).toHaveLength(8);
    expect(r[0]).toMatchObject({ round: 'r16', matchNo: 1, slotA: 1, slotB: 2 });
    expect(r[7]).toMatchObject({ matchNo: 8, slotA: 15, slotB: 16 });
  });
  it('8枠なら4試合でラウンドはqf', () => {
    const r = seedRound1('kids', 8);
    expect(r).toHaveLength(4);
    expect(r[0].round).toBe('qf');
  });
});

describe('次の試合', () => {
  it('勝者が未確定のいちばん若い試合', () => {
    expect(nextUndecided([m(1, 1, 2, 1), m(2, 3, 4), m(3, 5, 6)])?.matchNo).toBe(2);
  });
  it('全部決まっていれば null', () => {
    expect(nextUndecided([m(1, 1, 2, 1), m(2, 3, 4, 3)])).toBeNull();
  });
  it('不戦勝(相手なし)は次の試合として出さない', () => {
    // slotB が空 = 欠席。自動的に勝者扱いなので操作は不要
    expect(nextUndecided([m(1, 1, null), m(2, 3, 4)])?.matchNo).toBe(2);
  });
});

describe('ラウンドの進行', () => {
  it('全試合が決まったら完了', () => {
    expect(isRoundComplete([m(1, 1, 2, 1), m(2, 3, 4, 4)])).toBe(true);
    expect(isRoundComplete([m(1, 1, 2, 1), m(2, 3, 4)])).toBe(false);
  });
  it('不戦勝だけの試合も完了扱い', () => {
    expect(isRoundComplete([m(1, 1, null), m(2, 3, 4, 3)])).toBe(true);
  });
  it('勝者を次のラウンドへ繰り上げる', () => {
    const r16 = [m(1, 1, 2, 1), m(2, 3, 4, 4), m(3, 5, 6, 5), m(4, 7, 8, 8)];
    const qf = advanceRound('beginner', 'r16', r16);
    expect(qf).toHaveLength(2);
    expect(qf[0]).toMatchObject({ round: 'qf', matchNo: 1, slotA: 1, slotB: 4 });
    expect(qf[1]).toMatchObject({ matchNo: 2, slotA: 5, slotB: 8 });
  });
  it('不戦勝は相手のいる側が自動的に勝者になる', () => {
    const r16 = [m(1, 1, null), m(2, 3, 4, 3)];
    const qf = advanceRound('beginner', 'r16', r16);
    expect(qf[0]).toMatchObject({ slotA: 1, slotB: 3 });
  });
  it('決勝の次は無い', () => {
    expect(advanceRound('kids', 'f', [{ round: 'f', matchNo: 1, slotA: 1, slotB: 2, winnerSlot: 1 }])).toEqual([]);
  });
});
