import { describe, it, expect } from 'vitest';
import { applyByes, seedRound1, nextPendingMatch } from '../bf6Bracket';
import { buildBracketRows } from '../bf6BracketRows';

// 受付中(まだトーナメントが始まっていない)のLED表示。
// くじを引いた人から順に1回戦に名前が入っていくが、まだ引いていない枠を不戦勝として
// 扱ってはいけない。扱うと、先に引いた人が上の段へ勝ち上がって見えてしまう(2026-09-11)。
const beginner = (holders: number[]) => applyByes(seedRound1('beginner', 16), new Set(holders));
// ビギナーの段: [優勝, 決勝, 準決勝, ベスト8, ベスト16]
const QF = 3;
const R16 = 4;

describe('受付中のトーナメント表(自動で反映)', () => {
  it('引いた人は1回戦の枠に名前が入る', () => {
    const rows = buildBracketRows('beginner', beginner([1, 5]), { pending: true });
    const filled = rows[R16].cells.filter((c) => c.slotNo !== null).map((c) => c.slotNo);
    expect(filled).toEqual([1, 5]);
  });

  it('相手がまだ引いていなくても、上の段には上がらない', () => {
    const rows = buildBracketRows('beginner', beginner([1, 5]), { pending: true });
    expect(rows[QF].cells.every((c) => c.slotNo === null)).toBe(true);
  });

  it('始まった後は、相手のいない人は不戦勝で上の段に上がる(今までどおり)', () => {
    const rows = buildBracketRows('beginner', beginner([1, 5]));
    expect(rows[QF].cells.map((c) => c.slotNo)).toContain(1);
  });
});

describe('受付中の「次の試合」', () => {
  it('両方がくじを引き終わった、いちばん若い試合', () => {
    expect(nextPendingMatch(beginner([1, 3, 4]))).toMatchObject({ matchNo: 2, slotA: 3, slotB: 4 });
  });

  it('両方そろった試合が無ければ出さない', () => {
    expect(nextPendingMatch(beginner([1, 3, 5]))).toBeNull();
  });
});
