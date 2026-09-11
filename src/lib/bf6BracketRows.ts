// 縦型トーナメント表(下から上へ)の段組みを作る。純ロジック・DOMに触らない。
//
// TARO 2026-09-07: 左→右ではなく「下から上へ名前カードがせり上がる」形にする。
// 一番下が1回戦、上に行くほど枠が半分になり、最上段が優勝者。
// 負けた人はカードを消さずグレーアウトさせる(誰が誰に負けたかが見えるため)。
import { roundsFor, type Round } from './bf6Bracket';
import type { Bf6DrawDivision } from './bf6Draw';

/**
 * alive   … まだ勝ち残っている(オレンジ)。負けるまでずっとこれ
 * lost    … 負けた(グレー+取り消し線)
 * empty   … 誰もいない枠
 * ⚠️ 「その試合に勝った」ではなく「勝ち残っているか」で塗る。上の段に上がった人が
 *    白のままだと目立たない(TARO実機 2026-09-10)。
 */
export type CellState = 'alive' | 'lost' | 'empty';

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
function byeAwareWinner(m: M): number | null {
  if (m.slotA !== null && m.slotB === null) return m.slotA;
  if (m.slotB !== null && m.slotA === null) return m.slotB;
  return m.winnerSlot;
}

function cellFor(m: M, slot: number | null, lost: Set<number>): BracketCell {
  if (slot === null) return { slotNo: null, state: 'empty', round: m.round, matchNo: m.matchNo };
  // 一度でも負けていればグレー。それ以外は勝ち残り扱い(オレンジ)。
  const state: CellState = lost.has(slot) ? 'lost' : 'alive';
  return { slotNo: slot, state, round: m.round, matchNo: m.matchNo };
}

/**
 * 段を上から順に返す(先頭が最上段=優勝、末尾が最下段=1回戦)。
 * 試合がまだ無いラウンドは、枠だけを空で用意する。
 */
export function buildBracketRows(
  division: Bf6DrawDivision,
  matches: M[],
  opts: { pending?: boolean } = {}
): BracketRow[] {
  const rounds = roundsFor(division);
  // 受付中(トーナメント開始前)は、まだ引いていない枠を不戦勝として扱わない。
  // 扱うと、先に引いた人が上の段へ勝ち上がって見える(2026-09-11)。
  const effectiveWinner = opts.pending ? (m: M) => m.winnerSlot : byeAwareWinner;
  // 負けた人の枠。これ以外の名前入りの枠は「まだ勝ち残っている」= オレンジで出す。
  // 上の段に上がった人が白のままだと目立たない(TARO実機 2026-09-10)。
  const lost = new Set<number>();
  for (const m of matches) {
    const w = effectiveWinner(m);
    if (w === null) continue;
    for (const s of [m.slotA, m.slotB]) if (s !== null && s !== w) lost.add(s);
  }
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
        : { slotNo: champ, state: 'alive', round: 'f', matchNo: 1 },
    ],
  });

  // 上から順に f → sf → qf → r16
  for (let i = rounds.length - 1; i >= 0; i -= 1) {
    const rd = rounds[i];
    const expected = firstCount > 0 ? firstCount / Math.pow(2, i) : Math.pow(2, rounds.length - 1 - i);
    const ms = (byRound.get(rd) ?? []).slice().sort((a, b) => a.matchNo - b.matchNo);
    // 下の段(1つ前のラウンド)。次の試合がまだ作られていなくても、勝者が決まった時点で
    // 上の段に名前を出す(勝った瞬間にせり上がる演出のため・TARO実機 2026-09-10)。
    const below = i > 0 ? (byRound.get(rounds[i - 1]) ?? []) : [];
    const feederWinner = (matchNo: number, side: 0 | 1): number | null => {
      const f = below.find((m) => m.matchNo === matchNo * 2 - 1 + side);
      return f ? effectiveWinner(f) : null;
    };
    const cells: BracketCell[] = [];
    for (let k = 0; k < expected; k += 1) {
      const m = ms[k];
      if (!m) {
        // 試合レコードが無い段: 下の段で決まった勝者を「待機中」として置く
        for (const side of [0, 1] as const) {
          const w = feederWinner(k + 1, side);
          cells.push(
            w === null
              ? { slotNo: null, state: 'empty', round: rd, matchNo: k + 1 }
              : { slotNo: w, state: 'alive', round: rd, matchNo: k + 1 }
          );
        }
        continue;
      }
      cells.push(cellFor(m, m.slotA, lost));
      cells.push(cellFor(m, m.slotB, lost));
    }
    rows.push({ kind: 'round', round: rd, cells });
  }

  return rows;
}
