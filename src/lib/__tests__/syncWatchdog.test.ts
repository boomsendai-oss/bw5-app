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

  it('21時間前のokは stale', () => {
    const r = evaluateSyncFreshness('2026-07-19 03:10:00', NOW);
    expect(r.stale).toBe(true);
    expect(r.hours).toBe(21);
    expect(r.message).toContain('21時間');
  });

  it('しきい値は20時間', () => {
    expect(SYNC_STALE_HOURS).toBe(20);
  });

  // 2026-07-30: TAROは日中ノートPCを持ち出すため 12:00/18:00枠が飛ぶのが平常。
  // 正常な最大間隔は 06:00→翌00:00 の18時間なので、これを誤報にしてはいけない。
  it('日中2枠が飛んだだけでは stale にしない(平常運転・18時間ギャップ)', () => {
    // 最後の成功 = 7/30 06:03 JST、点検 = 7/30 19:40 JST(story-watchdog)
    const r = evaluateSyncFreshness(
      '2026-07-29 21:03:00',
      new Date('2026-07-30T10:40:00Z'),
    );
    expect(r.stale).toBe(false);
  });

  it('Vercel Cronが40分遅れても平常運転なら誤報しない(旧14hだと誤報していた)', () => {
    // 点検が 20:20 JST にずれたケース: 経過14時間17分 → 旧しきい値14hでは stale
    const r = evaluateSyncFreshness(
      '2026-07-29 21:03:00',
      new Date('2026-07-30T11:20:00Z'),
    );
    expect(r.hours).toBe(14);
    expect(r.stale).toBe(false);
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

// 2026-07-29の誤診対策: 起動しているのに成功しない場合は「スリープ」と言わない
describe('起動中だが連続失敗しているケース', () => {
  const now = new Date('2026-07-29T11:37:00Z');

  it('直近に実行行があれば「動いているが成功していない」と伝える', () => {
    const r = evaluateSyncFreshness('2026-07-28 14:00:00', now, '2026-07-29 09:45:38');
    expect(r.stale).toBe(true);
    expect(r.message).toContain('動いていますが');
    // 原因をスリープと断定しない(「スリープではなく」と否定形で触れるのはOK)
    expect(r.message).toContain('スリープではなく');
    expect(r.message).toContain('CSV取得');
  });

  it('実行行自体が古ければ従来どおりスリープ/cron停止を疑う', () => {
    const r = evaluateSyncFreshness('2026-07-28 14:00:00', now, '2026-07-28 14:00:00');
    expect(r.stale).toBe(true);
    expect(r.message).toContain('スリープ');
  });
});
