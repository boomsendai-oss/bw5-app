// 当日オペのトップに出す「あと何人 / あといくら」の集計(純ロジック)。
//
// ⚠️ 「39 / 45」のような分数は当日その場では読み違える。実機で
//    「45人やらなきゃいけない中で39人まだやってない」と読まれた(TARO 2026-09-16)。
//    残っている数を主役にし、分母は添えるだけにする。

export type SummaryEntrant = {
  itemId: number;
  divisions: string[];
  checkedIn: boolean;
};

export type CountSummary = { total: number; done: number; remaining: number };

/** バトルエントリーの受付(チェックイン)。 */
export function entryReceptionSummary(entrants: SummaryEntrant[]): CountSummary {
  const done = entrants.filter((e) => e.checkedIn).length;
  return { total: entrants.length, done, remaining: entrants.length - done };
}

/**
 * 本戦の枠数は部門ごと。
 * ⚠️ 形を変えるときは bf6Format.ts の BF6_FORMAT だけを書き換える。
 */
import { bracketSizeFor } from './bf6Format';

export type PhotoDivision = 'beginner' | 'kids' | 'general';

export type PhotoDivisionSummary = CountSummary & {
  division: PhotoDivision;
  label: string;
  /** まだ撮る時期ではない(予選が終わっていない)。 */
  waiting: boolean;
};

const PHOTO_ORDER: { division: PhotoDivision; label: string }[] = [
  { division: 'beginner', label: 'ビギナー' },
  { division: 'kids', label: '小中学生' },
  { division: 'general', label: '一般' },
];

/**
 * 部門ごとの写真撮影の進み具合。
 *
 * ビギナーは予選が無いのでエントリー全員をそのまま撮る。
 * 小中・一般は予選を通った8名だけが対象なので、通過者が出そろうまでは
 * 「8名ぶんあるが、まだ撮る時期ではない」という状態で見せる。
 */
export function photoSummary(
  entrants: SummaryEntrant[],
  photoItemIds: Set<number>,
  qualifiers: Record<string, Set<number>>
): PhotoDivisionSummary[] {
  return PHOTO_ORDER.map(({ division, label }) => {
    const inDivision = entrants.filter((e) => e.divisions.includes(division));
    const passed = qualifiers[division] ?? new Set<number>();
    // 予選が要らない規模(8名以下)なら、その部門は最初から全員が本戦=撮影対象
    const size = bracketSizeFor(division);
    const needsQualifier = division !== 'beginner' && inDivision.length > size;

    if (!needsQualifier) {
      const done = inDivision.filter((e) => photoItemIds.has(e.itemId)).length;
      return {
        division, label, waiting: false,
        total: inDivision.length, done, remaining: inDivision.length - done,
      };
    }

    const waiting = passed.size < size;
    const target = waiting ? size : passed.size;
    const done = waiting ? 0 : inDivision.filter((e) => passed.has(e.itemId) && photoItemIds.has(e.itemId)).length;
    return { division, label, waiting, total: target, done, remaining: target - done };
  });
}
