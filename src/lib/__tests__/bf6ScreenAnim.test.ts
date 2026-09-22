import { describe, it, expect } from 'vitest';
import { detectNewWinners, vsAnimKey } from '../bf6ScreenAnim';

const m = (round: string, matchNo: number, a: number | null, b: number | null, w: number | null) => ({
  round, matchNo, slotA: a, slotB: b, winnerSlot: w,
});

describe('新しく決まった勝者の検出(演出を1回だけ出すため)', () => {
  it('勝者がついた試合を返す', () => {
    const prev = [m('qf', 1, 1, 2, null)];
    const next = [m('qf', 1, 1, 2, 1)];
    expect(detectNewWinners(prev, next)).toEqual([{ round: 'qf', matchNo: 1, winnerSlot: 1 }]);
  });

  it('同じ状態が続いても二度目は返さない(1秒ごとのポーリングで再生され続けない)', () => {
    const s = [m('qf', 1, 1, 2, 1)];
    expect(detectNewWinners(s, s)).toEqual([]);
  });

  it('複数の試合が同時に確定しても全部返す', () => {
    const prev = [m('qf', 1, 1, 2, null), m('qf', 2, 3, 4, null)];
    const next = [m('qf', 1, 1, 2, 2), m('qf', 2, 3, 4, 3)];
    expect(detectNewWinners(prev, next)).toHaveLength(2);
  });

  it('勝者が訂正されたら(押し間違いの修正)新しい勝者として返す', () => {
    const prev = [m('qf', 1, 1, 2, 1)];
    const next = [m('qf', 1, 1, 2, 2)];
    expect(detectNewWinners(prev, next)).toEqual([{ round: 'qf', matchNo: 1, winnerSlot: 2 }]);
  });

  it('勝者が取り消されたら演出しない', () => {
    const prev = [m('qf', 1, 1, 2, 1)];
    const next = [m('qf', 1, 1, 2, null)];
    expect(detectNewWinners(prev, next)).toEqual([]);
  });

  it('前の状態が無いとき(画面を開いた直後)は演出しない', () => {
    const next = [m('qf', 1, 1, 2, 1)];
    expect(detectNewWinners(null, next)).toEqual([]);
  });

  it('次のラウンドの試合が増えても、勝者が無ければ演出しない', () => {
    const prev = [m('qf', 1, 1, 2, 1)];
    const next = [m('qf', 1, 1, 2, 1), m('sf', 1, 1, null, null)];
    expect(detectNewWinners(prev, next)).toEqual([]);
  });
});

describe('VS画面の登場アニメを再生する単位', () => {
  it('部門・ラウンド・試合が同じなら同じキー(再生し直さない)', () => {
    const k1 = vsAnimKey({ division: 'beginner', round: 'qf', matchNo: 1 });
    const k2 = vsAnimKey({ division: 'beginner', round: 'qf', matchNo: 1 });
    expect(k1).toBe(k2);
  });

  it('試合が変わればキーが変わる(再生し直す)', () => {
    const k1 = vsAnimKey({ division: 'beginner', round: 'qf', matchNo: 1 });
    const k2 = vsAnimKey({ division: 'beginner', round: 'qf', matchNo: 2 });
    expect(k1).not.toBe(k2);
  });

  it('部門が変わればキーが変わる', () => {
    expect(vsAnimKey({ division: 'beginner', round: 'f', matchNo: 1 }))
      .not.toBe(vsAnimKey({ division: 'kids', round: 'f', matchNo: 1 }));
  });

  it('ラウンドや試合が未確定でもキーを作れる', () => {
    expect(typeof vsAnimKey({ division: 'kids', round: null, matchNo: null })).toBe('string');
  });
});

describe('部門の切り替え', () => {
  it('部門が変わったときは演出しない(ラウンド名が部門間で同じなので誤検出する)', () => {
    // beginner の qf/1 は 3 が勝者、kids の qf/1 は 5 が勝者 — 別の試合なのにキーが同じ
    const prev = [m('qf', 1, 3, 4, 3)];
    const next = [m('qf', 1, 5, 6, 5)];
    expect(detectNewWinners(prev, next, { prevScope: 'beginner', scope: 'kids' })).toEqual([]);
  });

  it('部門が同じなら通常どおり検出する', () => {
    const prev = [m('qf', 1, 3, 4, null)];
    const next = [m('qf', 1, 3, 4, 3)];
    expect(detectNewWinners(prev, next, { prevScope: 'kids', scope: 'kids' }))
      .toEqual([{ round: 'qf', matchNo: 1, winnerSlot: 3 }]);
  });
});

describe('勝者が上がる先の枠', () => {
  it('1回戦の第1・第2試合の勝者は、ベスト8の第1試合へ上がる', async () => {
    const { parentMatch } = await import('../bf6ScreenAnim');
    expect(parentMatch('beginner', 'r16', 1)).toEqual({ round: 'qf', matchNo: 1 });
    expect(parentMatch('beginner', 'r16', 2)).toEqual({ round: 'qf', matchNo: 1 });
  });

  it('第3・第4試合の勝者はベスト8の第2試合へ', async () => {
    const { parentMatch } = await import('../bf6ScreenAnim');
    expect(parentMatch('beginner', 'r16', 3)).toEqual({ round: 'qf', matchNo: 2 });
    expect(parentMatch('beginner', 'r16', 4)).toEqual({ round: 'qf', matchNo: 2 });
  });

  it('決勝の勝者に上の試合は無い(優勝枠へ入る)', async () => {
    const { parentMatch } = await import('../bf6ScreenAnim');
    expect(parentMatch('beginner', 'f', 1)).toBeNull();
  });

  it('小中学生・一般はベスト8が最初なので、その上は準決勝', async () => {
    const { parentMatch } = await import('../bf6ScreenAnim');
    expect(parentMatch('kids', 'qf', 1)).toEqual({ round: 'sf', matchNo: 1 });
    expect(parentMatch('kids', 'qf', 4)).toEqual({ round: 'sf', matchNo: 2 });
  });

  it('知らないラウンドならnull', async () => {
    const { parentMatch } = await import('../bf6ScreenAnim');
    expect(parentMatch('kids', 'r16', 1)).toBeNull();
  });
});

// ── 場面の切り替わり判定(クロスフェード用) ──
// TARO実機 2026-09-16「場面が切り替わる時にふわっとフェードインフェードアウトみたいな方がいい」
describe('場面キー', () => {
  const s = (p: Partial<{ mode: string; division: string; round: string | null; matchNo: number | null; rev: number }>) => ({
    mode: 'logo', division: 'beginner', round: null, matchNo: null, rev: 0, ...p,
  });

  it('ロゴは部門や試合が変わっても同じ場面(切り替え演出を出さない)', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'logo', division: 'kids', round: 'qf', matchNo: 3 }))).toBe(
      sceneKey(s({ mode: 'logo', division: 'general', round: 'f', matchNo: 1 }))
    );
  });

  it('トーナメント表は部門が変われば別の場面', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'bracket', division: 'kids' }))).not.toBe(
      sceneKey(s({ mode: 'bracket', division: 'general' }))
    );
  });

  it('トーナメント表は試合が進んでも同じ場面(勝者演出を邪魔しない)', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'bracket', division: 'kids', round: 'qf', matchNo: 1 }))).toBe(
      sceneKey(s({ mode: 'bracket', division: 'kids', round: 'sf', matchNo: 2 }))
    );
  });

  it('VSは試合ごとに別の場面', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'vs', division: 'kids', round: 'qf', matchNo: 1 }))).not.toBe(
      sceneKey(s({ mode: 'vs', division: 'kids', round: 'qf', matchNo: 2 }))
    );
  });

  it('ロゴとトーナメント表とVSは互いに別の場面', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    const keys = [
      sceneKey(s({ mode: 'logo' })),
      sceneKey(s({ mode: 'bracket' })),
      sceneKey(s({ mode: 'vs', round: 'qf', matchNo: 1 })),
    ];
    expect(new Set(keys).size).toBe(3);
  });

  it('優勝者発表はロゴと別の場面(切り替えに暗転を挟む)', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'champions' }))).not.toBe(sceneKey(s({ mode: 'logo' })));
  });

  it('優勝者発表は部門が変わっても同じ場面(3部門を同時に映すため)', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'champions', division: 'kids' }))).toBe(
      sceneKey(s({ mode: 'champions', division: 'general' }))
    );
  });

  it('revが増えただけでは場面は変わらない(バトルスタート等で無駄に暗転させない)', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s({ mode: 'vs', round: 'qf', matchNo: 1, rev: 3 }))).toBe(
      sceneKey(s({ mode: 'vs', round: 'qf', matchNo: 1, rev: 9 }))
    );
  });
});

// ── 優勝者発表: ドラムロール → 発表(TARO 2026-09-22) ──
describe('ドラムロール画面', () => {
  const s = (mode: string) => ({ mode, division: 'kids', round: null, matchNo: null, rev: 0 });

  it('ドラムロールから発表へは暗転させない(ジャーンの瞬間に即座に出すため同じ場面)', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s('drumroll'))).toBe(sceneKey(s('champions')));
  });

  it('ロゴからドラムロールへは場面が変わる', async () => {
    const { sceneKey } = await import('../bf6ScreenAnim');
    expect(sceneKey(s('drumroll'))).not.toBe(sceneKey(s('logo')));
  });

  it('ドラムロール中も優勝者のデータを渡す(写真を先に読み込んで、発表の瞬間に遅れなく出すため)', async () => {
    const { needsChampions } = await import('../bf6ScreenAnim');
    expect(needsChampions('drumroll')).toBe(true);
    expect(needsChampions('champions')).toBe(true);
    expect(needsChampions('vs')).toBe(false);
    expect(needsChampions('logo')).toBe(false);
  });
});
