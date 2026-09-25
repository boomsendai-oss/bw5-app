// LED演出のトリガー判定(純ロジック・DOMに触らない)。
//
// LED画面は1秒ごとに状態を取りに行くため、素直に描くと「勝者が決まった」演出が
// 毎秒再生されてしまう。前回の状態と比べて“今回はじめて確定した勝者”だけを返す。

import { roundsFor } from './bf6Bracket';
import type { Bf6DrawDivision } from './bf6Draw';

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
  const order: string[] = roundsFor(division as Bf6DrawDivision);
  const i = order.indexOf(round);
  if (i < 0 || i === order.length - 1) return null;
  return { round: order[i + 1], matchNo: Math.ceil(matchNo / 2) };
}

/**
 * いま映している「場面」の識別子。これが変わったときだけ暗転→切り替えを挟む。
 * (TARO実機 2026-09-16「場面が切り替わる時にふわっとフェードインフェードアウトの方がいい」)
 *
 * revは混ぜない。バトルスタートのように同じ試合のまま状態だけ変わる操作で
 * 暗転させてしまうため。逆にトーナメント表では round/matchNo を見ない
 * (試合が進むたびに暗転すると、勝者が上がっていく演出が消える)。
 */
export function sceneKey(s: {
  mode: string;
  division: string;
  round: string | null;
  matchNo: number | null;
}): string {
  if (s.mode === 'vs') return `vs|${s.division}|${s.round ?? '-'}|${s.matchNo ?? '-'}`;
  if (s.mode === 'bracket') return `bracket|${s.division}`;
  // 優勝者発表は3部門を同時に映すので、部門が何であっても1つの場面。
  // ドラムロール → 発表 も同じ場面にする(暗転を挟むと「ジャーン」の瞬間に遅れる・TARO 2026-09-22)
  if (s.mode === 'champions' || s.mode === 'drumroll') return 'champions';
  // 記念撮影用の1人カード。部門を切り替えたら入れ替わる
  // 配信の確認画面。部門を切り替えても場面は同じ(暗転で映像が止まらないように)
  if (s.mode === 'stream') return 'stream';
  if (s.mode === 'champion') return `champion|${s.division}`;
  if (s.mode === 'runnerup') return `runnerup|${s.division}`;
  return 'logo';
}

/**
 * 画面に優勝者のデータを渡すか。発表の前のドラムロール中から渡し、写真を先に読み込ませる
 * (発表の瞬間に写真だけ遅れて出るのを防ぐ)。名前はドラムロール画面には描かない。
 */
export function needsChampions(mode: string): boolean {
  return mode === 'champions' || mode === 'drumroll' || mode === 'champion' || mode === 'runnerup';
}

/**
 * LEDに渡す試合から、決勝の勝者だけを消す。対戦カードは残す。
 * ⚠️ 優勝者は表彰でまとめて発表する(ドラムロール → 発表)。決勝の勝者を入れたあとに
 *    トーナメント表を映すと、優勝枠に名前が出てネタバレになる(TARO 2026-09-22 実機確認で判明)。
 *    勝者の光る演出も、この値の変化から起きるので一緒に止まる。
 */
export function hideFinalWinner<T extends { round: string; winnerSlot: number | null }>(matches: T[]): T[] {
  return matches.map((m) => (m.round === 'f' ? { ...m, winnerSlot: null } : m));
}

/**
 * 決勝で負けた人(準優勝)の枠番号。勝者が決まるまでは null。
 * 不戦勝で相手がいないときも null(準優勝者はいない)。
 */
export function runnerUpSlot(m: { slotA: number | null; slotB: number | null; winnerSlot: number | null } | undefined): number | null {
  if (!m || m.winnerSlot === null) return null;
  if (m.winnerSlot === m.slotA) return m.slotB;
  if (m.winnerSlot === m.slotB) return m.slotA;
  return null;
}
