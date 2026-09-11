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

/** 両方とも空の試合(その山に誰もいない)。表示も操作も要らない。 */
export function isEmptyMatch(m: Match): boolean {
  return m.slotA === null && m.slotB === null;
}

/** 片方しかいない試合=不戦勝。VSは出さず自動で勝ち上がる(TARO 2026-09-10)。 */
export function isByeMatch(m: Match): boolean {
  return !isEmptyMatch(m) && (m.slotA === null || m.slotB === null);
}

/** 操作が必要な次の試合。不戦勝と空の試合は飛ばす。 */
export function nextUndecided(matches: Match[]): Match | null {
  return matches.find((m) => !isEmptyMatch(m) && effectiveWinner(m) === null) ?? null;
}

/** 空の試合は「済んだ」扱い。不戦勝は自動確定。 */
export function isRoundComplete(matches: Match[]): boolean {
  return matches.every((m) => isEmptyMatch(m) || effectiveWinner(m) !== null);
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

/**
 * 誰も引いていない枠を空(null=不戦勝)にする。
 *
 * ビギナーは枠が16固定なので、欠席や未受付があると「番号はあるが人がいない枠」が残る。
 * それを対戦相手として出すと、LEDに「JIN vs 2番」のような試合が映り、勝者も押せない
 * (TARO実機 2026-09-10)。人がいない枠は最初から不戦勝として扱う。
 */
export function applyByes(matches: Match[], holders: Set<number>): Match[] {
  return matches.map((m) => ({
    ...m,
    slotA: m.slotA !== null && holders.has(m.slotA) ? m.slotA : null,
    slotB: m.slotB !== null && holders.has(m.slotB) ? m.slotB : null,
  }));
}

export type ReflectPlan =
  | {
      kind: 'ok';
      /** 1回戦のあるべき姿(そのまま書き込む) */
      matches: Match[];
      /** 作り直すために消す後ろのラウンド */
      dropRounds: Round[];
      /** 変わった試合の数。0なら何もしなくてよい */
      changed: number;
    }
  | { kind: 'blocked'; reason: string };

/**
 * くじ引きの結果をトーナメントに反映する計画を立てる。
 *
 * 以前の「作る」は1回きりで、早く押すと未受付の枠が不戦勝のまま固まっていた(TARO 2026-09-11)。
 * 反映は「今のくじ引き状態に合わせ直す」操作なので、試合前なら何度押してもよい。
 * 遅れて来た人が空き枠を引いたら、不戦勝だった試合が対戦に戻る。
 *
 * 決着した試合は壊さない。組み合わせが変わる試合にすでに勝者がいたら、止めて理由を返す。
 */
export function planBracketReflect(
  division: Bf6DrawDivision,
  stored: Match[],
  slotCount: number,
  holders: Set<number>
): ReflectPlan {
  const rounds = roundsFor(division);
  const first = rounds[0];
  const fresh = applyByes(seedRound1(division, slotCount), holders);
  const storedFirst = new Map(stored.filter((m) => m.round === first).map((m) => [m.matchNo, m]));
  const later = stored.filter((m) => m.round !== first);

  const matches: Match[] = [];
  let changed = 0;
  for (const f of fresh) {
    const s = storedFirst.get(f.matchNo);
    if (s && s.slotA === f.slotA && s.slotB === f.slotB) {
      matches.push(s);
      continue;
    }
    if (s && s.winnerSlot !== null) {
      return {
        kind: 'blocked',
        reason: `${roundLabel(first)} 第${f.matchNo}試合はもう勝者が決まっているので、組み合わせを変えられません`,
      };
    }
    matches.push({ ...f, winnerSlot: null });
    changed += 1;
  }

  if (changed === 0) return { kind: 'ok', matches, dropRounds: [], changed: 0 };

  if (later.some((m) => m.winnerSlot !== null)) {
    return {
      kind: 'blocked',
      reason: 'もう次のラウンドの試合が終わっているので、1回戦の組み合わせを変えられません',
    };
  }
  const dropRounds = rounds.filter((r) => r !== first && later.some((m) => m.round === r));
  return { kind: 'ok', matches, dropRounds, changed };
}

/** まだ誰も引いていない枠の数。反映すると不戦勝になる枠。 */
export function undrawnSlotCount(slotCount: number, holders: Set<number>): number {
  let n = 0;
  for (let s = 1; s <= slotCount; s += 1) if (!holders.has(s)) n += 1;
  return n;
}

/**
 * 受付中(まだトーナメントが始まっていない)の「次の試合」。
 * 両方がくじを引き終わった、いちばん若い試合。不戦勝はまだ決めない。
 */
export function nextPendingMatch(matches: Match[]): Match | null {
  return matches.find((m) => m.slotA !== null && m.slotB !== null && m.winnerSlot === null) ?? null;
}
