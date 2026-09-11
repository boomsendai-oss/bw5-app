// 当日受付(スタッフ・クルーの受付画面)の部門タブ。純ロジック・DBに触らない。
//
// 全部門が1つの一覧に混ざっていると、名前を押してから部門を選ぶ手間があり押し間違いも起きる。
// タブで部門を切り替え、その部門の人だけを並べる(TARO 2026-09-11)。
import type { Bf6DrawPhase } from './bf6Draw';

export type ReceptionDraw = { division: string; phase: string; slotNo: number; block?: 'A' | 'B' };
export type ReceptionRow = { itemId: number; divisions: string[]; draws: ReceptionDraw[]; checkedIn: boolean };

const LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };

/** 受付時は3部門。予選後のくじ引き②は小中と一般だけ(ビギナーは受付時に位置まで決まる)。 */
export function divisionsForPhase(phase: Bf6DrawPhase): string[] {
  return phase === 'bracket' ? ['kids', 'general'] : ['beginner', 'kids', 'general'];
}

/**
 * 実際に引くくじの種類。
 * ⚠️ 受付時(①)の画面でも、ビギナーはトーナメント位置(bracket)を引く。
 *    画面のフェーズをそのまま使うと、ビギナーにはブロックの枠が無く「空き枠がありません」になる。
 */
export function drawPhaseFor(division: string, screenPhase: Bf6DrawPhase): Bf6DrawPhase {
  if (screenPhase === 'bracket') return 'bracket';
  return division === 'beginner' ? 'bracket' : 'block';
}

export function entrantsInDivision<T extends ReceptionRow>(rows: T[], division: string): T[] {
  return rows.filter((r) => r.divisions.includes(division));
}

/** その部門・その画面のくじ引きで引いた結果。もう片方の部門や、①②の違う結果は混ぜない。 */
export function drawFor(row: ReceptionRow, division: string, screenPhase: Bf6DrawPhase): ReceptionDraw | null {
  const phase = drawPhaseFor(division, screenPhase);
  return row.draws.find((d) => d.division === division && d.phase === phase) ?? null;
}

export type ReceptionTab = { division: string; label: string; drawn: number; total: number };

/** タブに出す「引いた人数 / その部門の人数」。 */
export function receptionTabs(rows: ReceptionRow[], screenPhase: Bf6DrawPhase): ReceptionTab[] {
  return divisionsForPhase(screenPhase).map((division) => {
    const inDiv = entrantsInDivision(rows, division);
    return {
      division,
      label: LABEL[division] ?? division,
      drawn: inDiv.filter((r) => drawFor(r, division, screenPhase) !== null).length,
      total: inDiv.length,
    };
  });
}
