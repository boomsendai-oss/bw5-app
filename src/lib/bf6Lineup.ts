// 予選の「並ばせ方」と、優勝者発表の並び(純ロジック・DOMに触らない)。
//
// 当日の運用(TARO 2026-09-16):
//   くじ引き①でA/Bブロックが決まったら、ブロックごとに「エントリーが早い順」で並べて出す。
//   係はこの順番のとおりに人を並ばせる(実際の並びは半円だが、画面は折り返した札で足りる。
//   横スクロールする図は当日一目で見えず役に立たない・TARO実機 2026-09-16)。
//   ジャッジが「左から3番目」と指名したら、図の同じ位置をタップして通過者にする。
//   目で名前を探すより速く、押し間違いも減る。

import type { Bf6DrawDivision } from './bf6Draw';

export type LineupPerson = { itemId: number; dancerName: string; block: 'A' | 'B' | null };

/**
 * そのブロックに並ぶ人を、左から右の順で返す。
 * 申込項目IDの昇順＝エントリーが早い順。ブロックをまだ引いていない人は立ち位置が
 * 決まらないので並べない。
 */
export function lineupForBlock(people: LineupPerson[], block: 'A' | 'B'): LineupPerson[] {
  return people.filter((p) => p.block === block).sort((a, b) => a.itemId - b.itemId);
}

/**
 * 優勝者発表の並び。左からビギナー・一般・小中学生(TARO 2026-09-22 に変更)。
 * 会場では決勝の2人ずつをこの並びでステージに立たせ、間のジャッジが3部門同時に勝者の手を上げる。
 * LEDはその背景になるので、立ち位置と同じ並びにする。
 */
export const CHAMPION_ORDER: Bf6DrawDivision[] = ['beginner', 'general', 'kids'];
