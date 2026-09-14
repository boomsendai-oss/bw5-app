// 予選通過者(小中・一般のベスト8)の純ロジック。DBに触らない。
//
// 流れ: 予選終了 → スタッフが通過者を8名タップ → くじ引き②はその8名だけ → 写真もその8名だけ → LED
// 通過者を先に確定させるのは、くじ引き②の一覧に部門全員を出すと押し間違いが起きるため(TARO 2026-09-09)。

import type { Bf6DrawDivision } from './bf6Draw';

/** ベスト8なので8名。ビギナーは予選が無いので対象外。 */
export const QUALIFIER_COUNT = 8;

export function hasQualifierStage(division: string): division is Exclude<Bf6DrawDivision, 'beginner'> {
  return division === 'kids' || division === 'general';
}

/** 通過者のチェックが「ちょうど8名」で揃っているか。くじ引き②に進める条件。 */
export function qualifiersReady(count: number): boolean {
  return count === QUALIFIER_COUNT;
}

/** 予選1回のときの、1ブロックあたりの通過者。A4名・B4名で合計8名。 */
export const QUALIFIER_PER_BLOCK = 4;

/**
 * その人を選べるか。選べないときは理由の文、選べるときは null。
 *
 * 予選1回: Aブロック4名・Bブロック4名で確定するので、同じブロックの5人目は選ばせない。
 * 予選2回: 2次予選はA/Bを合体させた1サークルなのでブロックの上限は効かない(perBlock=false)。
 */
export function qualifierPickError(
  selectedBlocks: ('A' | 'B' | null)[],
  block: 'A' | 'B' | null,
  perBlock: boolean
): string | null {
  if (selectedBlocks.length >= QUALIFIER_COUNT) {
    return `${QUALIFIER_COUNT}名までです。外してから選び直してください`;
  }
  if (!perBlock || block === null) return null;
  const inBlock = selectedBlocks.filter((b) => b === block).length;
  if (inBlock >= QUALIFIER_PER_BLOCK) {
    return `${block}ブロックは${QUALIFIER_PER_BLOCK}名までです。予選を2回やる場合は「ブロックの上限を外す」を押してください`;
  }
  return null;
}

/** 選択の切り替え。9人目は入れない(押し間違い防止)。 */
export function toggleQualifier(selected: Set<number>, itemId: number): Set<number> {
  const next = new Set(selected);
  if (next.has(itemId)) next.delete(itemId);
  else if (next.size < QUALIFIER_COUNT) next.add(itemId);
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
