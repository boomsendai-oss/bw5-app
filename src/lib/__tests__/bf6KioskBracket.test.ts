import { describe, it, expect } from 'vitest';
import { buildKioskBracket, opponentSlotsByRound } from '../bf6KioskBracket';

describe('各段で当たりうる相手の枠', () => {
  it('16枠の7番: 1回戦は8番', () => {
    expect(opponentSlotsByRound(7, 16)[0]).toEqual([8]);
  });

  it('16枠の7番: 準々決勝は5-6番の勝者', () => {
    expect(opponentSlotsByRound(7, 16)[1]).toEqual([5, 6]);
  });

  it('16枠の7番: 準決勝は1-4番の山', () => {
    expect(opponentSlotsByRound(7, 16)[2]).toEqual([1, 2, 3, 4]);
  });

  it('16枠の7番: 決勝は9-16番の山', () => {
    expect(opponentSlotsByRound(7, 16)[3]).toEqual([9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it('1番から見ても対称になる', () => {
    expect(opponentSlotsByRound(1, 16)).toEqual([
      [2],
      [3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16],
    ]);
  });

  it('16番(いちばん下)から見ると相手は上側になる', () => {
    expect(opponentSlotsByRound(16, 16)).toEqual([
      [15],
      [13, 14],
      [9, 10, 11, 12],
      [1, 2, 3, 4, 5, 6, 7, 8],
    ]);
  });

  it('段数は log2(枠数)', () => {
    expect(opponentSlotsByRound(3, 8)).toHaveLength(3);
    expect(opponentSlotsByRound(3, 16)).toHaveLength(4);
  });

  it('自分自身は相手に出てこない', () => {
    for (let s = 1; s <= 16; s += 1) {
      for (const round of opponentSlotsByRound(s, 16)) {
        expect(round).not.toContain(s);
      }
    }
  });

  it('全段の相手を合わせると自分以外の全員になる(重複なし)', () => {
    const all = opponentSlotsByRound(6, 16).flat().sort((a, b) => a - b);
    expect(all).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });
});

describe('受付の結果画面に出す表', () => {
  const holders = { 7: 'AM', 8: 'JIN', 5: 'NOA' };

  it('1回戦の組み合わせが枠順に並ぶ', () => {
    const b = buildKioskBracket(7, 16, holders);
    expect(b.pairs).toHaveLength(8);
    expect(b.pairs[0].seats.map((s) => s.slotNo)).toEqual([1, 2]);
    expect(b.pairs[3].seats.map((s) => s.slotNo)).toEqual([7, 8]);
  });

  it('自分がいる山に印がつく', () => {
    const b = buildKioskBracket(7, 16, holders);
    expect(b.pairs.filter((p) => p.mine)).toHaveLength(1);
    expect(b.pairs[3].mine).toBe(true);
  });

  it('まだ引いていない枠は名前が空になる(受付が進むと埋まる)', () => {
    const b = buildKioskBracket(7, 16, holders);
    expect(b.pairs[3].seats[1].name).toBe('JIN');
    expect(b.pairs[0].seats[0].name).toBeNull();
  });

  it('1回戦の相手が確定していれば名前を出す', () => {
    const b = buildKioskBracket(7, 16, holders);
    expect(b.path[0]).toMatchObject({ label: '1回戦', opponentName: 'JIN' });
  });

  it('2段目以降は相手が絞れないので名前は出さない', () => {
    const b = buildKioskBracket(7, 16, holders);
    expect(b.path[1].opponentName).toBeNull();
    expect(b.path[1].opponentSlots).toEqual([5, 6]);
  });

  it('16枠なら 1回戦→準々決勝→準決勝→決勝', () => {
    const b = buildKioskBracket(7, 16, holders);
    expect(b.path.map((p) => p.label)).toEqual(['1回戦', '準々決勝', '準決勝', '決勝']);
  });

  it('8枠なら準々決勝は無い', () => {
    const b = buildKioskBracket(3, 8, {});
    expect(b.path.map((p) => p.label)).toEqual(['1回戦', '準決勝', '決勝']);
  });
});
