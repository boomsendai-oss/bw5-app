import { describe, it, expect } from 'vitest';
import {
  roundsFor,
  roundLabel,
  seedRound1,
  advanceRound,
  nextUndecided,
  isRoundComplete,
  type Match,
  applyByes,
  isByeMatch,
  isEmptyMatch,
  planBracketReflect,
  undrawnSlotCount,
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

describe('人がいない枠は不戦勝', () => {
  it('引いていない枠は null になり、引いた枠は残る', () => {
    const r1 = seedRound1('beginner', 16);
    const out = applyByes(r1, new Set([1, 6, 7, 15]));
    expect(out[0]).toMatchObject({ slotA: 1, slotB: null }); // 1 vs (2は空)
    expect(out[2]).toMatchObject({ slotA: null, slotB: 6 }); // (5は空) vs 6
    expect(out[3]).toMatchObject({ slotA: 7, slotB: null });
    expect(out[7]).toMatchObject({ slotA: 15, slotB: null });
  });

  it('不戦勝の試合は自動で決まり、次の試合探しで飛ばされる', () => {
    const out = applyByes(seedRound1('beginner', 16), new Set([1, 6, 7, 15]));
    expect(nextUndecided(out)).toBeNull(); // 全部片側だけ=全部不戦勝
  });

  it('両方いる試合だけが「次の試合」になる', () => {
    const out = applyByes(seedRound1('beginner', 16), new Set([1, 2, 6, 7]));
    expect(nextUndecided(out)).toMatchObject({ matchNo: 1, slotA: 1, slotB: 2 });
  });

  it('両方いない試合は両方 null(その山は空のまま上がる)', () => {
    const out = applyByes(seedRound1('beginner', 16), new Set([1]));
    expect(out[1]).toMatchObject({ slotA: null, slotB: null });
  });
});

describe('不戦勝と空の試合の扱い(VSを出さず自動で上げる)', () => {
  it('片方だけの試合は不戦勝、両方いないのは空', () => {
    const [bye, empty, real] = applyByes(seedRound1('beginner', 6), new Set([1, 5, 6]));
    expect(isByeMatch(bye)).toBe(true); // 1 vs (2は空)
    expect(isEmptyMatch(empty)).toBe(true); // 3,4 とも空
    expect(isByeMatch(real)).toBe(false); // 5 vs 6
    expect(isEmptyMatch(real)).toBe(false);
  });

  it('空の試合はラウンド完了の判定に含めない', () => {
    const r1 = applyByes(seedRound1('beginner', 4), new Set([1]));
    // 1 vs 空(不戦勝) / 空 vs 空 → 誰も操作しなくても完了
    expect(isRoundComplete(r1)).toBe(true);
  });

  it('不戦勝の勝者はそのまま次のラウンドへ上がり、空の山は空のまま', () => {
    const r1 = applyByes(seedRound1('beginner', 4), new Set([1]));
    const next = advanceRound('beginner', 'r16', r1);
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({ slotA: 1, slotB: null }); // また不戦勝
  });
});

describe('くじ引きの結果をトーナメントに反映する(何度押しても安全)', () => {
  // 「作る」を早く押すと、まだ引いていない枠が不戦勝のまま固まっていた(TARO 2026-09-11)。
  // 反映は現在のくじ引き状態に合わせ直す操作にし、試合前なら何度押してもよいようにする。
  const r1 = (holders: number[], slots = 16) => applyByes(seedRound1('beginner', slots), new Set(holders));
  const all16 = Array.from({ length: 16 }, (_, i) => i + 1);

  it('まだ試合が無ければ、1回戦を全部作る', () => {
    const p = planBracketReflect('beginner', [], 16, new Set(all16));
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.matches).toHaveLength(8);
    expect(p.changed).toBe(8);
    expect(p.dropRounds).toEqual([]);
  });

  it('くじ引きが変わっていなければ何も変えない', () => {
    const stored = r1(all16);
    const p = planBracketReflect('beginner', stored, 16, new Set(all16));
    expect(p.kind === 'ok' && p.changed).toBe(0);
  });

  it('遅れて来た人が空いていた枠を引いたら、不戦勝だった試合が対戦に戻る', () => {
    const noShow = all16.filter((s) => s !== 4); // 4番が未受付 → 第2試合(3 vs 4)は不戦勝
    const stored = r1(noShow);
    expect(stored[1]).toMatchObject({ slotA: 3, slotB: null });
    const p = planBracketReflect('beginner', stored, 16, new Set(all16)); // 4番を後から引いた
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.changed).toBe(1);
    expect(p.matches[1]).toMatchObject({ matchNo: 2, slotA: 3, slotB: 4, winnerSlot: null });
  });

  it('勝者が決まっている試合の組み合わせは変えられない(止めて理由を出す)', () => {
    const stored = r1(all16).map((m) => (m.matchNo === 1 ? { ...m, winnerSlot: 1 } : m));
    const p = planBracketReflect('beginner', stored, 16, new Set(all16.filter((s) => s !== 2)));
    expect(p.kind).toBe('blocked');
  });

  it('次のラウンドで勝者が決まっていたら、1回戦は変えられない', () => {
    const noShow = all16.filter((s) => s !== 4);
    const stored = [
      ...r1(noShow).map((m) => (m.slotA && m.slotB ? { ...m, winnerSlot: m.slotA } : m)),
      { round: 'qf' as const, matchNo: 1, slotA: 1, slotB: 3, winnerSlot: 1 },
    ];
    const p = planBracketReflect('beginner', stored, 16, new Set(all16));
    expect(p.kind).toBe('blocked');
  });

  it('次のラウンドが作られていても未決着なら、作り直す対象にする', () => {
    const noShow = all16.filter((s) => s !== 4);
    const stored = [
      ...r1(noShow).map((m) => (m.slotA && m.slotB ? { ...m, winnerSlot: m.slotA } : m)),
      { round: 'qf' as const, matchNo: 1, slotA: 1, slotB: 3, winnerSlot: null },
    ];
    const p = planBracketReflect('beginner', stored, 16, new Set(all16));
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') return;
    expect(p.dropRounds).toEqual(['qf']);
  });

  it('小中・一般はベスト8から作る', () => {
    const p = planBracketReflect('kids', [], 8, new Set([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(p.kind === 'ok' && p.matches.every((m) => m.round === 'qf')).toBe(true);
  });

  it('まだ引いていない枠の数を返す(押す前に警告を出すため)', () => {
    expect(undrawnSlotCount(16, new Set([1, 2, 3]))).toBe(13);
  });
});
