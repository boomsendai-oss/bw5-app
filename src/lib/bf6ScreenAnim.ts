// LED演出のトリガー判定(純ロジック・DOMに触らない)。
//
// LED画面は1秒ごとに状態を取りに行くため、素直に描くと「勝者が決まった」演出が
// 毎秒再生されてしまう。前回の状態と比べて“今回はじめて確定した勝者”だけを返す。

export type AnimMatch = {
  round: string;
  matchNo: number;
  slotA: number | null;
  slotB: number | null;
  winnerSlot: number | null;
};

export type NewWinner = { round: string; matchNo: number; winnerSlot: number };

/**
 * 前回と今回を比べて、新しく勝者が確定した試合を返す。
 * 押し間違いの訂正(勝者が別の人に変わった)も「新しい確定」として扱う。
 * 取り消し(勝者→null)と、初回描画(prev=null)は演出しない。
 *
 * scope には部門を渡す。ラウンド名(qf/sf/f)は部門間で共通なので、
 * 部門を切り替えただけで「勝者が変わった」と誤検出してしまうため。
 */
export function detectNewWinners(
  prev: AnimMatch[] | null,
  next: AnimMatch[],
  scope?: { prevScope: string | null; scope: string }
): NewWinner[] {
  if (!prev) return [];
  if (scope && scope.prevScope !== scope.scope) return [];
  const before = new Map(prev.map((m) => [`${m.round}|${m.matchNo}`, m.winnerSlot]));
  const out: NewWinner[] = [];
  for (const m of next) {
    if (m.winnerSlot === null) continue;
    const was = before.get(`${m.round}|${m.matchNo}`);
    // 前回その試合が存在しなかった場合(次ラウンドが生成された直後など)は演出しない
    if (was === undefined) continue;
    if (was !== m.winnerSlot) {
      out.push({ round: m.round, matchNo: m.matchNo, winnerSlot: m.winnerSlot });
    }
  }
  return out;
}

/**
 * VS画面の登場アニメを再生する単位。
 * これをReactのkeyに使い、試合が変わったときだけ要素を作り直して再生させる。
 * revを混ぜないのは、無関係な状態変更で毎回再生し直さないため。
 */
export function vsAnimKey(s: {
  division: string;
  round: string | null;
  matchNo: number | null;
}): string {
  return `${s.division}|${s.round ?? '-'}|${s.matchNo ?? '-'}`;
}

/**
 * その試合の勝者が上がっていく先の試合。
 * 勝者が決まった瞬間に「上の段の枠へカードがせり上がる」演出を出すために使う。
 * 決勝には上が無いのでnull(優勝枠は別扱い)。
 */
export function parentMatch(
  division: string,
  round: string,
  matchNo: number
): { round: string; matchNo: number } | null {
  const order = division === 'beginner' ? ['r16', 'qf', 'sf', 'f'] : ['qf', 'sf', 'f'];
  const i = order.indexOf(round);
  if (i < 0 || i === order.length - 1) return null;
  return { round: order[i + 1], matchNo: Math.ceil(matchNo / 2) };
}
