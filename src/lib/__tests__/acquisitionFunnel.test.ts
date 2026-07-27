import { describe, it, expect } from 'vitest';
import { buildMonthlyFunnel, buildReferralBreakdown, type FunnelTrialRow } from '../acquisitionFunnel';

const TODAY = '2026-07-27';

const row = (o: Partial<FunnelTrialRow> & { reserved_at: string }): FunnelTrialRow => ({
  status: '予約済',
  attendance_override: null,
  enrolled_after: 0,
  referral_source: null,
  ...o,
});

describe('buildMonthlyFunnel', () => {
  it('体験日の月に集計し、キャンセル・ノーショーは分母から外す', () => {
    const rows = [
      row({ reserved_at: '2026-06-01 19:00:00', enrolled_after: 1 }),
      row({ reserved_at: '2026-06-10 19:00:00' }),
      row({ reserved_at: '2026-06-15 19:00:00', status: 'キャンセル' }),
      row({ reserved_at: '2026-06-20 19:00:00', attendance_override: 'noshow' }),
      row({ reserved_at: '2026-07-05 19:00:00', enrolled_after: 1 }),
    ];
    const r = buildMonthlyFunnel(rows, TODAY);
    expect(r).toEqual([
      { ym: '2026-06', trials: 2, enrolled: 1, canceled: 1, noshow: 1, cvr: 0.5 },
      { ym: '2026-07', trials: 1, enrolled: 1, canceled: 0, noshow: 0, cvr: 1 },
    ]);
  });

  it('まだ来ていない予約は月にも分母にも入れない', () => {
    const r = buildMonthlyFunnel([row({ reserved_at: '2026-08-18 19:00:00' })], TODAY);
    expect(r).toEqual([]);
  });

  it('分母0の月は cvr を null にする(0%と区別する)', () => {
    const r = buildMonthlyFunnel([row({ reserved_at: '2026-06-15 19:00:00', status: 'キャンセル' })], TODAY);
    expect(r).toEqual([{ ym: '2026-06', trials: 0, enrolled: 0, canceled: 1, noshow: 0, cvr: null }]);
  });
});

describe('buildReferralBreakdown', () => {
  it('流入経路ごとに体験と入会を数える', () => {
    const rows = [
      row({ reserved_at: '2026-06-01 19:00:00', referral_source: '知り合いからのご紹介', enrolled_after: 1 }),
      row({ reserved_at: '2026-06-02 19:00:00', referral_source: '知り合いからのご紹介' }),
      row({ reserved_at: '2026-06-03 19:00:00', referral_source: 'googleなどのWEB検索', enrolled_after: 1 }),
      row({ reserved_at: '2026-06-04 19:00:00', referral_source: null }),
      row({ reserved_at: '2026-06-05 19:00:00', referral_source: 'インスタグラム', status: 'キャンセル' }),
    ];
    const r = buildReferralBreakdown(rows, TODAY);
    expect(r).toEqual([
      { channel: '紹介', trials: 2, enrolled: 1, cvr: 0.5 },
      { channel: 'ネット検索', trials: 1, enrolled: 1, cvr: 1 },
      { channel: '未記入', trials: 1, enrolled: 0, cvr: 0 },
    ]);
  });

  it('体験が1件も無い経路は行に出さない', () => {
    const r = buildReferralBreakdown([row({ reserved_at: '2026-06-01 19:00:00' })], TODAY);
    expect(r.map((x) => x.channel)).toEqual(['未記入']);
  });
});
