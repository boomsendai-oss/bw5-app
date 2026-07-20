import { describe, it, expect } from 'vitest';
import { evaluateSyncFreshness, SYNC_STALE_HOURS } from '../syncWatchdog';

// sync_runs.ran_at は UTC の 'YYYY-MM-DD HH:MM:SS' 形式で入る
const NOW = new Date('2026-07-20T00:10:00Z'); // JST 9:10 = story-watchdog の起動時刻

describe('evaluateSyncFreshness', () => {
  it('直近にokがあれば stale ではない', () => {
    const r = evaluateSyncFreshness('2026-07-19 21:03:21', NOW); // 約3時間前
    expect(r.stale).toBe(false);
    expect(r.message).toBeNull();
  });

  it('13時間前のokは まだ stale ではない(6h間隔の1回飛ばしを許容)', () => {
    const r = evaluateSyncFreshness('2026-07-19 11:10:00', NOW);
    expect(r.stale).toBe(false);
  });

  it('15時間前のokは stale', () => {
    const r = evaluateSyncFreshness('2026-07-19 09:10:00', NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBe(15);
    expect(r.message).toContain('15時間');
  });

  it('しきい値は14時間', () => {
    expect(SYNC_STALE_HOURS).toBe(14);
  });

  it('okの記録が1件も無ければ stale', () => {
    const r = evaluateSyncFreshness(null, NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBeNull();
    expect(r.message).toContain('一度も成功していません');
  });

  it('日付として解釈できない値は stale 扱いにする(fail-closed)', () => {
    const r = evaluateSyncFreshness('not-a-date', NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBeNull();
  });

  it('未来日付でも stale にはしない(時計ズレで誤爆させない)', () => {
    const r = evaluateSyncFreshness('2026-07-20 05:00:00', NOW);
    expect(r.stale).toBe(false);
  });
});
