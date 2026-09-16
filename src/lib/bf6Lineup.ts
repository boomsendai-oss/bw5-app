// 予選の「並ばせ方」と、優勝者発表の並び(純ロジック・DOMに触らない)。
//
// 当日の運用(TARO 2026-09-16):
//   くじ引き①でA/Bブロックが決まったら、ブロックごとに半円状に人を並べる。
//   並びは「エントリーが早い順に左から右」。係はこの図を見て人を並ばせる。
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

/** 半円の見た目。端を少し内側に入れて、札が画面から切れないようにする。 */
const ARC_X = 46; // 中心からの横の広がり(%)
const ARC_Y = 34; // 真ん中がどれだけ上がるか(%)
const ARC_BASE = 52; // 両端の高さ(%)

export type ArcPosition = { leftPct: number; topPct: number };

/**
 * n人を半円に沿って置いたときの位置(%)。
 * 1番目が左端、n番目が右端。真ん中がいちばん高い(ドーム型)。
 * ⚠️ n=1 のとき (n-1) で割らないこと。
 */
export function arcPositions(n: number): ArcPosition[] {
  if (n <= 0) return [];
  if (n === 1) return [{ leftPct: 50, topPct: ARC_BASE - ARC_Y }];
  return Array.from({ length: n }, (_, i) => {
    // 左(180°)から右(0°)へ等間隔
    const rad = Math.PI * (1 - i / (n - 1));
    return {
      leftPct: 50 + ARC_X * Math.cos(rad),
      topPct: ARC_BASE - ARC_Y * Math.sin(rad),
    };
  }).map((q) => ({ leftPct: Math.round(q.leftPct * 100) / 100, topPct: Math.round(q.topPct * 100) / 100 }));
}

/** 優勝者発表の並び。左からビギナー・小中学生・一般(TARO 2026-09-16)。 */
export const CHAMPION_ORDER: Bf6DrawDivision[] = ['beginner', 'kids', 'general'];
