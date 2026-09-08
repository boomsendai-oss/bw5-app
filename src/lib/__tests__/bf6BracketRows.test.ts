import { describe, it, expect } from 'vitest';
import { buildBracketRows } from '../bf6BracketRows';

const m = (round: string, matchNo: number, a: number | null, b: number | null, w: number | null) => ({
  round, matchNo, slotA: a, slotB: b, winnerSlot: w,
});

describe('下から上へ積む縦型トーナメント表', () => {
  it('1回戦が一番下、決勝が上、その上に優勝者の段がくる', () => {
    const rows = buildBracketRows('beginner', [
      m('r16', 1, 1, 2, null), m('r16', 2, 3, 4, null),
      m('r16', 3, 5, 6, null), m('r16', 4, 7, 8, null),
      m('qf', 1, null, null, null), m('qf', 2, null, null, null),
      m('sf', 1, null, null, null),
      m('f', 1, null, null, null),
    ]);
    // 配列の先頭が最上段(優勝)、末尾が最下段(1回戦)
    expect(rows[0].kind).toBe('champion');
    expect(rows[rows.length - 1].round).toBe('r16');
  });

  it('16名なら各段の人数は下から 16→8→4→2、最上段が優勝の1枠', () => {
    const r16 = Array.from({ length: 8 }, (_, i) => m('r16', i + 1, i * 2 + 1, i * 2 + 2, null));
    const rows = buildBracketRows('beginner', [
      ...r16,
      ...Array.from({ length: 4 }, (_, i) => m('qf', i + 1, null, null, null)),
      ...Array.from({ length: 2 }, (_, i) => m('sf', i + 1, null, null, null)),
      m('f', 1, null, null, null),
    ]);
    expect(rows.map((r) => r.cells.length)).toEqual([1, 2, 4, 8, 16]);
  });

  it('1回戦の枠には出場者が入る', () => {
    const rows = buildBracketRows('beginner', [m('r16', 1, 1, 2, null)]);
    const bottom = rows[rows.length - 1];
    expect(bottom.cells.map((c) => c.slotNo)).toEqual([1, 2]);
  });

  it('勝った人は勝者として、負けた人は敗者として印がつく', () => {
    const rows = buildBracketRows('beginner', [m('r16', 1, 1, 2, 1)]);
    const bottom = rows[rows.length - 1];
    expect(bottom.cells[0]).toMatchObject({ slotNo: 1, state: 'won' });
    expect(bottom.cells[1]).toMatchObject({ slotNo: 2, state: 'lost' });
  });

  it('まだ決着していない試合の2人はどちらも未決着', () => {
    const rows = buildBracketRows('beginner', [m('r16', 1, 1, 2, null)]);
    expect(rows[rows.length - 1].cells.map((c) => c.state)).toEqual(['pending', 'pending']);
  });

  it('勝者は1つ上の段に現れる', () => {
    const rows = buildBracketRows('beginner', [
      m('r16', 1, 1, 2, 1), m('r16', 2, 3, 4, 4),
      m('qf', 1, 1, 4, null),
    ]);
    const qf = rows.find((r) => r.round === 'qf')!;
    expect(qf.cells.map((c) => c.slotNo)).toEqual([1, 4]);
  });

  it('まだ上がってきていない枠は空として置かれる(枠自体は消さない)', () => {
    const rows = buildBracketRows('beginner', [
      m('r16', 1, 1, 2, null), m('r16', 2, 3, 4, null),
      m('qf', 1, null, null, null),
    ]);
    const qf = rows.find((r) => r.round === 'qf')!;
    expect(qf.cells.every((c) => c.slotNo === null)).toBe(true);
    expect(qf.cells).toHaveLength(2);
  });

  it('優勝者の段には決勝の勝者が入る', () => {
    const rows = buildBracketRows('beginner', [m('f', 1, 5, 9, 9)]);
    expect(rows[0].cells[0].slotNo).toBe(9);
    expect(rows[0].cells[0].state).toBe('won');
  });

  it('決勝が終わっていなければ優勝者の段は空', () => {
    const rows = buildBracketRows('beginner', [m('f', 1, 5, 9, null)]);
    expect(rows[0].cells[0].slotNo).toBeNull();
  });

  it('小中学生・一般はベスト8から始まる(ベスト16の段を作らない)', () => {
    const rows = buildBracketRows('kids', [
      m('qf', 1, 1, 2, null), m('qf', 2, 3, 4, null),
      m('sf', 1, null, null, null),
      m('f', 1, null, null, null),
    ]);
    expect(rows.some((r) => r.round === 'r16')).toBe(false);
    expect(rows[rows.length - 1].round).toBe('qf');
  });

  it('不戦勝(相手なし)は勝ち扱いにする', () => {
    const rows = buildBracketRows('beginner', [m('r16', 1, 7, null, null)]);
    const bottom = rows[rows.length - 1];
    expect(bottom.cells[0].state).toBe('won');
  });
});
