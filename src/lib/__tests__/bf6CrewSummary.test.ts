import { describe, it, expect } from 'vitest';
import { entryReceptionSummary, photoSummary } from '../bf6CrewSummary';

const e = (
  itemId: number,
  divisions: string[],
  checkedIn = false
) => ({ itemId, divisions, checkedIn });

describe('エントリー受付の残り', () => {
  it('受付が済んでいない人数を返す', () => {
    const s = entryReceptionSummary([e(1, ['beginner'], true), e(2, ['kids']), e(3, ['general'])]);
    expect(s).toEqual({ total: 3, done: 1, remaining: 2 });
  });

  it('全員済んだら残り0', () => {
    const s = entryReceptionSummary([e(1, ['beginner'], true), e(2, ['kids'], true)]);
    expect(s.remaining).toBe(0);
  });

  it('誰もいなければ0件', () => {
    expect(entryReceptionSummary([])).toEqual({ total: 0, done: 0, remaining: 0 });
  });
});

describe('部門ごとの写真撮影', () => {
  const entrants = [
    e(1, ['beginner']), e(2, ['beginner']), e(3, ['beginner']),
    e(4, ['kids']), e(5, ['kids']), e(6, ['kids']), e(7, ['kids']),
    e(8, ['kids']), e(9, ['kids']), e(10, ['kids']), e(11, ['kids']),
    e(12, ['kids']),
  ];

  it('ビギナーはエントリー全員が対象。受付と同時に撮れる', () => {
    const [b] = photoSummary(entrants, new Set([1]), {});
    expect(b.division).toBe('beginner');
    expect(b.total).toBe(3);
    expect(b.done).toBe(1);
    expect(b.remaining).toBe(2);
    expect(b.waiting).toBe(false);
  });

  it('小中は予選が終わるまで撮影待ち。人数はベスト8の8名として見せる', () => {
    const k = photoSummary(entrants, new Set(), {}).find((x) => x.division === 'kids')!;
    expect(k.waiting).toBe(true);
    expect(k.total).toBe(8);
    expect(k.done).toBe(0);
    expect(k.remaining).toBe(8);
  });

  it('予選通過者が8名そろったら撮影できる状態になる', () => {
    const q = { kids: new Set([4, 5, 6, 7, 8, 9, 10, 11]) };
    const k = photoSummary(entrants, new Set([4, 5]), q).find((x) => x.division === 'kids')!;
    expect(k.waiting).toBe(false);
    expect(k.done).toBe(2);
    expect(k.remaining).toBe(6);
  });

  it('通過者を選んでいる途中は、まだ撮影待ちのまま', () => {
    const q = { kids: new Set([4, 5, 6]) };
    const k = photoSummary(entrants, new Set(), q).find((x) => x.division === 'kids')!;
    expect(k.waiting).toBe(true);
  });

  it('通過者以外の写真は数えない(予選で負けた人を撮っても進まない)', () => {
    const q = { kids: new Set([4, 5, 6, 7, 8, 9, 10, 11]) };
    const k = photoSummary(entrants, new Set([12]), q).find((x) => x.division === 'kids')!;
    expect(k.done).toBe(0);
  });

  it('エントリーが8名以下の部門は予選をしないので、最初から全員が対象', () => {
    const few = [e(20, ['general']), e(21, ['general'])];
    const g = photoSummary(few, new Set([20]), {}).find((x) => x.division === 'general')!;
    expect(g.waiting).toBe(false);
    expect(g.total).toBe(2);
    expect(g.done).toBe(1);
  });

  it('ダブルエントリーの人は両方の部門で数える', () => {
    const both = [e(30, ['beginner', 'kids'])];
    const rows = photoSummary(both, new Set([30]), { kids: new Set([30]) });
    expect(rows.find((x) => x.division === 'beginner')!.done).toBe(1);
    expect(rows.find((x) => x.division === 'kids')!.done).toBe(1);
  });

  it('並びはビギナー→小中→一般(撮る順番)', () => {
    expect(photoSummary(entrants, new Set(), {}).map((x) => x.division)).toEqual([
      'beginner', 'kids', 'general',
    ]);
  });
});
