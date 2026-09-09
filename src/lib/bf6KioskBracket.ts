// 受付の結果画面に出す簡易トーナメント表。
//
// 出場者に「7番」とだけ伝えても何のことか分からない(TARO指摘 2026-09-09)。
// 自分がどこに入って、勝ち上がると誰と当たるのかまで見せる。
//
// 受付中はまだ試合(bf_match)が無いので、枠番号だけから組み立てる。
// 引いていない枠は名前が空になる = 受付が進むほど表が埋まっていく。

import { bracketPairs, opponentSlot } from './bf6Draw';

export type BracketSeat = { slotNo: number; name: string | null };
export type BracketPair = { seats: [BracketSeat, BracketSeat]; /** 自分がいる山か */ mine: boolean };

export type KioskBracket = {
  /** 1回戦の組み合わせ(上から順) */
  pairs: BracketPair[];
  /** 自分の勝ち上がり。1回戦から決勝まで、各段で当たりうる相手 */
  path: PathStep[];
};

export type PathStep = {
  /** 「1回戦」「準々決勝」など */
  label: string;
  /** その段で当たる相手。確定していれば名前、未確定なら候補の枠番号 */
  opponentName: string | null;
  opponentSlots: number[];
};

const ROUND_LABELS_16 = ['1回戦', '準々決勝', '準決勝', '決勝'];
const ROUND_LABELS_8 = ['1回戦', '準決勝', '決勝'];

function labelsFor(slotCount: number): string[] {
  return slotCount >= 16 ? ROUND_LABELS_16 : ROUND_LABELS_8;
}

/**
 * 自分の枠から見た、各段で当たりうる相手の枠番号。
 * 1回戦は隣の枠、2回戦は隣のペア2枠、3回戦は隣の4枠…と倍々になる。
 */
export function opponentSlotsByRound(slotNo: number, slotCount: number): number[][] {
  const out: number[][] = [];
  let size = 1; // 自分が属する山の大きさ
  let start = slotNo;
  while (size < slotCount) {
    // 現在の山の範囲 [start, start+size)
    const blockIndex = Math.floor((start - 1) / size);
    const isLeft = blockIndex % 2 === 0;
    const oppStart = isLeft ? start + size : start - size;
    out.push(Array.from({ length: size }, (_, i) => oppStart + i));
    start = isLeft ? start : start - size;
    size *= 2;
  }
  return out;
}

export function buildKioskBracket(
  mySlot: number,
  slotCount: number,
  holders: Record<number, string>
): KioskBracket {
  const name = (n: number) => holders[n] ?? null;

  const pairs: BracketPair[] = bracketPairs(slotCount).map(([a, b]) => ({
    seats: [
      { slotNo: a, name: name(a) },
      { slotNo: b, name: name(b) },
    ],
    mine: a === mySlot || b === mySlot,
  }));

  const labels = labelsFor(slotCount);
  const path: PathStep[] = opponentSlotsByRound(mySlot, slotCount).map((slots, i) => {
    // 相手が1人に絞れていて、その人が既に引いていれば名前を出す
    const only = slots.length === 1 ? name(slots[0]) : null;
    return { label: labels[i] ?? `${i + 1}回戦`, opponentName: only, opponentSlots: slots };
  });

  return { pairs, path };
}

/** 1回戦の相手枠(結果画面の見出し用) */
export { opponentSlot };
