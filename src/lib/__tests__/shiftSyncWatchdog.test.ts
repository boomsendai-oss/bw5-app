import { describe, it, expect } from 'vitest';
import { evaluateShiftSyncFreshness, SHIFT_SYNC_STALE_HOURS } from '../shiftSyncWatchdog';

// Lステップのシフト同期(GitHub Actions・毎朝5時JST)のデッドマンスイッチ。
// 「何も来ない＝正常」の運用にするため、止まったことをこちらから鳴らす。
const now = new Date('2026-09-20T00:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();

describe('evaluateShiftSyncFreshness', () => {
  it('前日に成功していれば正常', () => {
    const r = evaluateShiftSyncFreshness(hoursAgo(24), now);
    expect(r.stale).toBe(false);
    expect(r.message).toBeNull();
  });

  // GH Actions の schedule は +1.5〜5h ずれる。この程度で鳴らすと誤報になる。
  it('cronの遅れ程度では鳴らさない', () => {
    expect(evaluateShiftSyncFreshness(hoursAgo(29), now).stale).toBe(false);
  });

  it('2日ぶん動いていなければ異常', () => {
    const r = evaluateShiftSyncFreshness(hoursAgo(SHIFT_SYNC_STALE_HOURS + 1), now);
    expect(r.stale).toBe(true);
    expect(r.message).toMatch(/Lステップ/);
    expect(r.message).toMatch(/51時間/);
  });

  it('一度も成功していなければ異常', () => {
    const r = evaluateShiftSyncFreshness(null, now);
    expect(r.stale).toBe(true);
    expect(r.message).toMatch(/一度も/);
  });

  it('読めない値なら異常として知らせる', () => {
    const r = evaluateShiftSyncFreshness('こわれた値', now);
    expect(r.stale).toBe(true);
    expect(r.hours).toBeNull();
  });

  // 時計ズレで未来日付が入ることがある。誤爆でノイズを出す方が害が大きい。
  it('未来の日付は異常扱いにしない', () => {
    expect(evaluateShiftSyncFreshness(hoursAgo(-5), now).stale).toBe(false);
  });
});
