// 部門ごとの「大会の形」。⚠️ 形を変えるときは BF6_FORMAT だけを書き換える。
//
// 当日の形はエントリー数が確定してから決まる(TARO 2026-09-17)。
//   一般が11名のままなら … A/Bに分ける意味が薄い(1サークルで足りる)
//   もっと少なければ    … ベスト4まで絞る
//   16名を超えたら      … A/B 2ブロックのままベスト8
// 締切(9/24)後に人数を見て決められるよう、枠数と予選の形をここ1箇所に集めてある。
// 段数・くじ引きの枠数・予選通過者の人数・ブロックの上限・写真の対象人数は
// すべてここから導出される。

import type { Bf6DrawDivision } from './bf6Draw';
import type { Round } from './bf6Bracket';

/**
 * 予選の形。
 *  none   … 予選をしない(受付でそのまま本戦の位置を引く)
 *  single … 1サークルで回す。A/Bに分けない
 *  ab     … A・Bの2ブロックに分けて別々に回す
 */
export type QualifierStyle = 'none' | 'single' | 'ab';

/** 本戦の枠数。 */
export type BracketSize = 4 | 8 | 16;

export type Bf6Format = { qualifier: QualifierStyle; bracketSize: BracketSize };

/** ⚠️ 当日の形。ここを変えると全体が追従する。 */
export const BF6_FORMAT: Record<Bf6DrawDivision, Bf6Format> = {
  beginner: { qualifier: 'none', bracketSize: 16 },
  kids: { qualifier: 'ab', bracketSize: 8 },
  general: { qualifier: 'ab', bracketSize: 8 },
};

export function formatFor(division: Bf6DrawDivision): Bf6Format {
  return BF6_FORMAT[division];
}

export function bracketSizeFor(division: Bf6DrawDivision): BracketSize {
  return BF6_FORMAT[division].bracketSize;
}

/** 枠数から本戦の段を作る。16→ベスト16スタート、8→ベスト8、4→準決勝。 */
export function roundsForSize(size: BracketSize): Round[] {
  const all: Round[] = ['r16', 'qf', 'sf', 'f'];
  // 決勝から数えて、枠が半分になる回数ぶんだけ後ろから取る
  const depth = Math.log2(size);
  return all.slice(all.length - depth);
}

/** A・Bのブロックに分けて予選をやる部門か。 */
export function usesBlocks(division: Bf6DrawDivision): boolean {
  return BF6_FORMAT[division].qualifier === 'ab';
}

/** 予選をやる部門か。 */
export function hasQualifier(division: Bf6DrawDivision): boolean {
  return BF6_FORMAT[division].qualifier !== 'none';
}

/** 予選から本戦へ送り出す人数。本戦の枠数と同じ。予選が無ければ0。 */
export function qualifierCountFor(division: Bf6DrawDivision): number {
  return hasQualifier(division) ? bracketSizeFor(division) : 0;
}

/**
 * 1ブロックあたりの通過者の上限。A/Bに分けるときだけ効く(枠数の半分)。
 * 分けないときは null = 上限なし。
 */
export function qualifierPerBlockFor(division: Bf6DrawDivision): number | null {
  return usesBlocks(division) ? bracketSizeFor(division) / 2 : null;
}
