import { describe, it, expect } from 'vitest';
import {
  findUpcomingReturns,
  isNotifyWindow,
  buildReturnNotice,
  KYUKAI_MAX_MONTHS,
  type KyukaiMemberRow,
} from '../kyukaiWatch';

const row = (kaiin_no: string, plan_started_at: string | null, full_name = '会員テスト'): KyukaiMemberRow => ({
  kaiin_no,
  full_name,
  plan_started_at,
});

describe('isNotifyWindow', () => {
  it('月初1〜7日だけ通知する', () => {
    expect(isNotifyWindow('2026-09-01')).toBe(true);
    expect(isNotifyWindow('2026-09-07')).toBe(true);
    expect(isNotifyWindow('2026-09-08')).toBe(false);
    expect(isNotifyWindow('2026-09-30')).toBe(false);
  });
  it('壊れた日付は通知しない(誤爆よりノイズ0を優先)', () => {
    expect(isNotifyWindow('')).toBe(false);
    expect(isNotifyWindow('2026-09')).toBe(false);
  });
});

describe('findUpcomingReturns', () => {
  it('翌月に6ヶ月満了となる休会者だけを拾う', () => {
    // 2026-09 時点 → 翌月2026-10に復会するのは 2026-04 開始の人
    const rows = [
      row('0110', '2026-04-01'), // 2026-10 復会 → 対象
      row('0200', '2026-05-01'), // 2026-11 復会 → まだ
      row('0300', '2026-03-01'), // 2026-09 復会 → 今月(もう過ぎている)
    ];
    const got = findUpcomingReturns(rows, '2026-09-01');
    expect(got.map((g) => g.kaiinNo)).toEqual(['0110']);
    expect(got[0].returnDate).toBe('2026-10-01');
    expect(got[0].startedAt).toBe('2026-04-01');
  });

  it('年をまたいでも正しく数える', () => {
    // 2025-12開始 → 6ヶ月後は2026-06。2026-05時点の翌月が2026-06
    const got = findUpcomingReturns([row('0110', '2025-12-01')], '2026-05-03');
    expect(got).toHaveLength(1);
    expect(got[0].returnDate).toBe('2026-06-01');
  });

  it('実例: 会員0110は2026-05に予告されるべきだった(実際は通知が無く3ヶ月分を支払った)', () => {
    const rows = [row('0110', '2025-12-01')];
    expect(findUpcomingReturns(rows, '2026-04-01')).toHaveLength(0); // 2ヶ月前は鳴らさない
    expect(findUpcomingReturns(rows, '2026-05-01')).toHaveLength(1); // 1ヶ月前に鳴る
    expect(findUpcomingReturns(rows, '2026-06-01')).toHaveLength(0); // 当月はもう遅い
  });

  it('日時形式(YYYY-MM-DD HH:MM:SS)でも読める', () => {
    const got = findUpcomingReturns([row('0110', '2026-04-01 00:00:00')], '2026-09-01');
    expect(got).toHaveLength(1);
  });

  it('開始日が読めない行は鳴らさない', () => {
    expect(findUpcomingReturns([row('0110', null)], '2026-09-01')).toHaveLength(0);
    expect(findUpcomingReturns([row('0110', 'not-a-date')], '2026-09-01')).toHaveLength(0);
    expect(findUpcomingReturns([row('0110', '2026-13-01')], '2026-09-01')).toHaveLength(0);
  });

  it('上限を変えれば復会月も動く(将来4ヶ月等に変えた時の保険)', () => {
    const rows = [row('0110', '2026-06-01')];
    expect(findUpcomingReturns(rows, '2026-09-01', 4)).toHaveLength(1); // 2026-10復会
    expect(findUpcomingReturns(rows, '2026-09-01', 6)).toHaveLength(0); // 2026-12復会
  });

  it('既定の上限は6ヶ月', () => {
    expect(KYUKAI_MAX_MONTHS).toBe(6);
  });

  it('会員番号順に安定ソートされる', () => {
    const got = findUpcomingReturns(
      [row('0300', '2026-04-01'), row('0110', '2026-04-01'), row('0200', '2026-04-01')],
      '2026-09-01'
    );
    expect(got.map((g) => g.kaiinNo)).toEqual(['0110', '0200', '0300']);
  });
});

describe('buildReturnNotice', () => {
  it('対象ゼロなら通知しない', () => {
    expect(buildReturnNotice([])).toBeNull();
  });

  it('本文に人数・会員番号・復会日・次にやることが入る', () => {
    const notice = buildReturnNotice(
      findUpcomingReturns([row('0110', '2026-04-01', '山田 花子')], '2026-09-01')
    );
    expect(notice).not.toBeNull();
    expect(notice!.subject).toContain('2026年10月');
    expect(notice!.subject).toContain('1名');
    expect(notice!.body).toContain('会員0110');
    expect(notice!.body).toContain('山田 花子');
    expect(notice!.body).toContain('2026-10-01');
    expect(notice!.body).toContain('ご相談ください');
    expect(notice!.body).toContain('20日');
  });

  it('氏名・会員番号が欠けても本文が壊れない', () => {
    const notice = buildReturnNotice([
      { kaiinNo: '', name: '', startedAt: '2026-04-01', returnDate: '2026-10-01' } as never,
    ]);
    expect(notice).not.toBeNull();
  });
});
