// 予選の「並ばせ方」と、優勝者発表の並び(純ロジック・DOMに触らない)。
//
// 当日の運用(TARO 2026-09-16 / 並び順を 2026-09-25 に変更):
//   くじ引き①でA/Bブロックが決まったら、ブロックごとに「当日その場で受付した順」で並べて出す。
//   係はこの順番のとおりに人を並ばせる(実際の並びは半円だが、画面は折り返した札で足りる。
//   横スクロールする図は当日一目で見えず役に立たない・TARO実機 2026-09-16)。
//   ジャッジが「左から3番目」と指名したら、図の同じ位置をタップして通過者にする。
//   目で名前を探すより速く、押し間違いも減る。

import type { Bf6DrawDivision } from './bf6Draw';

export type LineupPerson = {
  itemId: number;
  dancerName: string;
  block: 'A' | 'B' | null;
  /** くじ引き①を引いた時刻(ISO)。＝当日その場で受付した順 */
  drawnAt?: string | null;
};

/**
 * そのブロックに並ぶ人を、左から右の順で返す。
 * ブロックをまだ引いていない人は立ち位置が決まらないので並べない。
 *
 * ⚠️ 並びは「当日受付した順」(くじ引き①を引いた時刻の昇順)。
 *    申込が早い順にすると、受付が進むたびに**既にいる人の間に新しい人が割り込む**ので、
 *    係が紙に書き写しながら進められない(TARO 2026-09-25)。
 *    受付順なら必ず右端に足されるだけなので、書き写した紙がそのまま使える。
 *    時刻が無い/同時のときは申込項目IDで決める(順番がぶれないように)。
 */
export function lineupForBlock<T extends LineupPerson>(people: T[], block: 'A' | 'B'): T[] {
  return people
    .filter((p) => p.block === block)
    .sort((a, b) => {
      const at = a.drawnAt ?? '';
      const bt = b.drawnAt ?? '';
      if (at !== bt) {
        if (!at) return 1; // 時刻が無い人は後ろへ
        if (!bt) return -1;
        return at < bt ? -1 : 1;
      }
      return a.itemId - b.itemId;
    });
}

/**
 * 優勝者発表の並び。左からビギナー・一般・小中学生(TARO 2026-09-22 に変更)。
 * 会場では決勝の2人ずつをこの並びでステージに立たせ、間のジャッジが3部門同時に勝者の手を上げる。
 * LEDはその背景になるので、立ち位置と同じ並びにする。
 */
export const CHAMPION_ORDER: Bf6DrawDivision[] = ['beginner', 'general', 'kids'];
