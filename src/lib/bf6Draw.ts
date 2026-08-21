// BF6 当日の抽選(くじ引き)ロジック。DBに触らない純粋な計算だけをここに置き、
// 保存・排他は bf6DrawDb.ts が担当する。
//
// 抽選は2回に分かれる(TARO確定 2026-08-21):
//   ① 受付時(13:30-14:00)
//        ビギナー … トーナメント表の位置(1〜16)をその場で確定
//        小中・一般 … A / B ブロックの振り分けのみ
//   ② 予選終了後(15:55-16:25)
//        小中・一般 … 予選通過者8名がベスト8トーナメントの位置(1〜8)を引く

export type Bf6DrawDivision = 'beginner' | 'kids' | 'general';
export type Bf6DrawPhase = 'block' | 'bracket';

export type DrawUnit = { itemId: number; division: Bf6DrawDivision };

/**
 * 抽選の単位は「人」ではなく「人 × 部門」。
 * 複数部門にエントリーしている人は、部門ごとに別の枠を引く。
 */
export function drawUnitsForEntry(itemId: number, divisions: string[]): DrawUnit[] {
  return divisions
    .filter((d): d is Bf6DrawDivision => d === 'beginner' || d === 'kids' || d === 'general')
    .map((division) => ({ itemId, division }));
}

/**
 * 用意するスロット数。
 * - ビギナー … 16固定。16人に満たなくても空き枠はBYE(不戦勝)として扱う
 * - 小中/一般の一次予選 … 実エントリー数ぶん(前半A・後半B)
 * - ベスト8トーナメント … 8固定
 */
export function slotCountFor(division: Bf6DrawDivision, phase: Bf6DrawPhase, entrantCount: number): number {
  if (division === 'beginner') return 16;
  return phase === 'bracket' ? 8 : entrantCount;
}

/** 前半をAブロック、後半をBブロックにする。奇数ならAが1人多い。 */
export function blockOfSlot(slotNo: number, total: number): 'A' | 'B' {
  return slotNo <= Math.ceil(total / 2) ? 'A' : 'B';
}

/** トーナメント1回戦の組み合わせ。隣どうしが対戦する。 */
export function bracketPairs(slotCount: number): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 1; i <= slotCount; i += 2) pairs.push([i, i + 1]);
  return pairs;
}

export type BracketMatch = { slotA: number; slotB: number; winnerSlot: number | null };

/**
 * 次にやる試合。まだ勝者が決まっていない、いちばん若い試合を返す。
 * 全部決着していれば null。
 *
 * 組み合わせは抽選で決まっているので、操作する人が「次のカード」を選ぶ必要はない。
 */
export function nextMatchIndex(matches: BracketMatch[]): number | null {
  const i = matches.findIndex((m) => m.winnerSlot === null);
  return i === -1 ? null : i;
}
