// BF6 トーナメントの進行ロジック。DBに触らない純粋な計算だけ。
// LED演出(/bf6/screen)と操作画面(/staff/bf6/control)が共通で使う。
//
// 組み合わせは当日のくじ引きで確定しているため、「次にどの試合をやるか」は
// 盤面の状態から一意に決まる。操作する人がカードを選ぶ必要はない。
import type { Bf6DrawDivision } from './bf6Draw';

export type Round = 'r16' | 'qf' | 'sf' | 'f';

export type Match = {
  round: Round;
  matchNo: number;
  slotA: number | null;
  slotB: number | null;
  winnerSlot: number | null;
};

/** ベスト16をやるのはビギナー部門だけ。小中・一般は予選で8名に絞るのでベスト8から。 */
export function roundsFor(division: Bf6DrawDivision): Round[] {
  return division === 'beginner' ? ['r16', 'qf', 'sf', 'f'] : ['qf', 'sf', 'f'];
}

export function roundLabel(round: Round): string {
  return { r16: 'ベスト16', qf: 'ベスト8', sf: '準決勝', f: '決勝' }[round];
}

/** 1回戦を作る。隣どうしの枠が対戦する。 */
export function seedRound1(division: Bf6DrawDivision, slotCount: number): Match[] {
  const round = roundsFor(division)[0];
  const out: Match[] = [];
  for (let i = 1, no = 1; i <= slotCount; i += 2, no += 1) {
    out.push({ round, matchNo: no, slotA: i, slotB: i + 1 <= slotCount ? i + 1 : null, winnerSlot: null });
  }
  return out;
}

/** 不戦勝(相手がいない)なら、いる側が自動的に勝者。 */
function effectiveWinner(m: Match): number | null {
  if (m.slotA !== null && m.slotB === null) return m.slotA;
  if (m.slotB !== null && m.slotA === null) return m.slotB;
  return m.winnerSlot;
}

/** 操作が必要な次の試合。不戦勝は自動確定なので飛ばす。 */
export function nextUndecided(matches: Match[]): Match | null {
  return matches.find((m) => effectiveWinner(m) === null) ?? null;
}

export function isRoundComplete(matches: Match[]): boolean {
  return matches.every((m) => effectiveWinner(m) !== null);
}

/** 勝者を次のラウンドへ繰り上げる。決勝の次は無い。 */
export function advanceRound(division: Bf6DrawDivision, current: Round, matches: Match[]): Match[] {
  const rounds = roundsFor(division);
  const next = rounds[rounds.indexOf(current) + 1];
  if (!next) return [];
  const winners = matches
    .slice()
    .sort((a, b) => a.matchNo - b.matchNo)
    .map(effectiveWinner);
  const out: Match[] = [];
  for (let i = 0, no = 1; i < winners.length; i += 2, no += 1) {
    out.push({ round: next, matchNo: no, slotA: winners[i] ?? null, slotB: winners[i + 1] ?? null, winnerSlot: null });
  }
  return out;
}
