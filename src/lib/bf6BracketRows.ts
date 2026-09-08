// 縦型トーナメント表(下から上へ)の段組みを作る。純ロジック・DOMに触らない。
//
// TARO 2026-09-07: 左→右ではなく「下から上へ名前カードがせり上がる」形にする。
// 一番下が1回戦、上に行くほど枠が半分になり、最上段が優勝者。
// 負けた人はカードを消さずグレーアウトさせる(誰が誰に負けたかが見えるため)。
import { roundsFor, type Round } from './bf6Bracket';
import type { Bf6DrawDivision } from './bf6Draw';

export type CellState = 'won' | 'lost' | 'pending' | 'empty';

export type BracketCell = {
  slotNo: number | null;
  state: CellState;
  /** この人が出ている試合。演出のトリガー判定に使う。 */
  round: string | null;
  matchNo: number | null;
};

export type BracketRow = {
  kind: 'round' | 'champion';
  round: Round | null;
  cells: BracketCell[];
};

type M = {
  round: string;
  matchNo: number;
  slotA: number | null;
  slotB: number | null;
  winnerSlot: number | null;
};

/** 不戦勝(相手がいない)は、いる側が勝ち。 */
function effectiveWinner(m: M): number | null {
  if (m.slotA !== null && m.slotB === null) return m.slotA;
  if (m.slotB !== null && m.slotA === null) return m.slotB;
  return m.winnerSlot;
}

function cellFor(m: M, slot: number | null): BracketCell {
  if (slot === null) return { slotNo: null, state: 'empty', round: m.round, matchNo: m.matchNo };
  const w = effectiveWinner(m);
  const state: CellState = w === null ? 'pending' : w === slot ? 'won' : 'lost';
  return { slotNo: slot, state, round: m.round, matchNo: m.matchNo };
}

/**
 * 段を上から順に返す(先頭が最上段=優勝、末尾が最下段=1回戦)。
 * 試合がまだ無いラウンドは、枠だけを空で用意する。
 */
export function buildBracketRows(division: Bf6DrawDivision, matches: M[]): BracketRow[] {
  const rounds = roundsFor(division);
  const byRound = new Map<string, M[]>();
  for (const m of matches) {
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }

  // 1回戦の試合数から各ラウンドの枠数を決める(試合がまだ無くても枠は出す)
  const first = rounds[0];
  const firstCount = (byRound.get(first) ?? []).length;

  const rows: BracketRow[] = [];

  // 最上段: 優勝者
  const finalMatches = (byRound.get('f') ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);
  const champ = finalMatches[0] ? effectiveWinner(finalMatches[0]) : null;
  rows.push({
    kind: 'champion',
    round: null,
    cells: [
      champ === null
        ? { slotNo: null, state: 'empty', round: 'f', matchNo: 1 }
        : { slotNo: champ, state: 'won', round: 'f', matchNo: 1 },
    ],
  });

  // 上から順に f → sf → qf → r16
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const rd = rounds[i];
    const expected = firstCount > 0 ? firstCount / Math.pow(2, i) : Math.pow(2, rounds.length - 1 - i);
    const ms = (byRound.get(rd) ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);
    const cells: BracketCell[] = [];
    for (let k = 0; k < expected; k += 1) {
      const m = ms[k];
      if (!m) {
        cells.push({ slotNo: null, state: 'empty', round: rd, matchNo: k + 1 });
        cells.push({ slotNo: null, state: 'empty', round: rd, matchNo: k + 1 });
        continue;
      }
      cells.push(cellFor(m, m.slotA));
      cells.push(cellFor(m, m.slotB));
    }
    rows.push({ kind: 'round', round: rd, cells });
  }

  return rows;
}
