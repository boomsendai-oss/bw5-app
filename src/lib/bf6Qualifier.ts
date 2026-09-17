// 予選通過者(小中・一般のベスト8)の純ロジック。DBに触らない。
//
// 流れ: 予選終了 → スタッフが通過者を8名タップ → くじ引き②はその8名だけ → 写真もその8名だけ → LED
// 通過者を先に確定させるのは、くじ引き②の一覧に部門全員を出すと押し間違いが起きるため(TARO 2026-09-09)。

import type { Bf6DrawDivision } from './bf6Draw';
import { qualifierCountFor, qualifierPerBlockFor } from './bf6Format';

/**
 * 通過者の人数。⚠️ 部門ごとに違う可能性があるので、画面では qualifierCountFor を使う。
 * この定数は「今の小中・一般は8名」という既定値として残してある。
 */
export const QUALIFIER_COUNT = 8;

export function hasQualifierStage(division: string): division is Exclude<Bf6DrawDivision, 'beginner'> {
  return division === 'kids' || division === 'general';
}

/** 通過者のチェックが人数ちょうどで揃っているか。くじ引き②に進める条件。 */
export function qualifiersReadyFor(division: Bf6DrawDivision, count: number): boolean {
  return count === qualifierCountFor(division);
}

/**
 * その人を選べるか。選べないときは理由の文、選べるときは null。
 *
 * A/Bに分けて予選をやる部門は、片方のブロックから枠の半分より多くは選ばせない
 * (押し間違いと、片側に偏った通過を防ぐ)。
 * 1サークルで回す部門・予選を2回やる場合はブロックの上限が無い。
 */
export function qualifierPickErrorFor(
  division: Bf6DrawDivision,
  selectedBlocks: ('A' | 'B' | null)[],
  block: 'A' | 'B' | null
): string | null {
  const total = qualifierCountFor(division);
  if (selectedBlocks.length >= total) {
    return `${total}名までです。外してから選び直してください`;
  }
  const perBlock = qualifierPerBlockFor(division);
  if (perBlock === null || block === null) return null;
  const inBlock = selectedBlocks.filter((b) => b === block).length;
  if (inBlock >= perBlock) {
    return `${block}ブロックは${perBlock}名までです。外してから選び直してください`;
  }
  return null;
}

/** 選択の切り替え。枠を超えては入れない(押し間違い防止)。 */
export function toggleQualifierFor(
  division: Bf6DrawDivision,
  selected: Set<number>,
  itemId: number
): Set<number> {
  const next = new Set(selected);
  if (next.has(itemId)) next.delete(itemId);
  else if (next.size < qualifierCountFor(division)) next.add(itemId);
  return next;
}

export type EntrantLike = { itemId: number; divisions: string[] };

/**
 * くじ引き②(ベスト8)の対象者に絞る。
 * ビギナーはそもそも対象外(受付時にトーナメント位置まで決まる)。
 * 小中・一般は通過者としてチェックされた人だけ。
 */
export function filterForBracketDraw<T extends EntrantLike>(
  entrants: T[],
  qualifiers: Record<string, Set<number>>
): T[] {
  return entrants
    .map((e) => ({
      ...e,
      divisions: e.divisions.filter(
        (d) => hasQualifierStage(d) && (qualifiers[d]?.has(e.itemId) ?? false)
      ),
    }))
    .filter((e) => e.divisions.length > 0);
}
