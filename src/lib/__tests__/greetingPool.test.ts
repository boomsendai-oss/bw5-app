import { describe, expect, it } from 'vitest';
import {
  GREETINGS,
  appendGreetingUse,
  pickGreeting,
  recentGreetingIds,
  renderGreeting,
} from '../greetingPool';

describe('一言プール (TARO採用47本・2026-09-05)', () => {
  it('採用47本・全部末尾が絵文字(TARO前提「最後に絵文字1個」)', () => {
    expect(GREETINGS.length).toBe(47);
    for (const g of GREETINGS) {
      expect(g.text, `id=${g.id}`).toMatch(/\p{Extended_Pictographic}$/u);
      expect(g.text.trim().length).toBeGreaterThan(5);
    }
    expect(new Set(GREETINGS.map((g) => g.id)).size).toBe(47);
  });

  it('不採用の文が混ざっていない(5,12,14,17,30,31,32,37,38,39,40,58,59)', () => {
    const ids = new Set(GREETINGS.map((g) => g.id));
    for (const ng of [5, 12, 14, 17, 30, 31, 32, 37, 38, 39, 40, 58, 59]) expect(ids.has(ng)).toBe(false);
  });

  it('週次用の文は「今日/本日」を含まない', () => {
    for (const g of GREETINGS.filter((g) => g.weekly)) expect(g.text).not.toMatch(/今日|本日/);
  });

  it('直近14日に使った文は除外される', () => {
    const uses = [
      { id: 2, ymd: '2026-09-01' },
      { id: 3, ymd: '2026-08-20' }, // 16日前 → 除外されない
    ];
    const recent = recentGreetingIds(uses, '2026-09-05');
    expect(recent.has(2)).toBe(true);
    expect(recent.has(3)).toBe(false);
    for (let i = 0; i < 50; i++) expect(pickGreeting(recent)!.id).not.toBe(2);
  });

  it('全部使用済みでも止まらずに何か選ぶ', () => {
    const all = new Set(GREETINGS.map((g) => g.id));
    expect(pickGreeting(all)).not.toBeNull();
  });

  it('★推し(weight 2)は出やすい', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const counts = new Map<number, number>();
    for (let i = 0; i < 20000; i++) {
      const g = pickGreeting(new Set(), { rand })!;
      counts.set(g.id, (counts.get(g.id) ?? 0) + 1);
    }
    const avg = 20000 / GREETINGS.length;
    expect(counts.get(29)!).toBeGreaterThan(avg * 1.5);
    expect(counts.get(51)!).toBeGreaterThan(avg * 1.5);
  });

  it('{n} は本数に置き換わる', () => {
    const g = GREETINGS.find((g) => g.id === 21)!;
    expect(renderGreeting(g, { count: 3 })).toBe('今日はこの3本です📌');
  });

  it('使用履歴は追記され、28日より古いものは捨てられる', () => {
    const uses = appendGreetingUse([{ id: 1, ymd: '2026-08-01' }, { id: 2, ymd: '2026-08-30' }], 9, '2026-09-05');
    expect(uses.map((u) => u.id)).toEqual([2, 9]);
  });
});
