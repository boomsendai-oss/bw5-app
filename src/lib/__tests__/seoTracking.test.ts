import { describe, it, expect } from 'vitest';
import { buildTrends, formatPosition, rankTier, sumByMonth, TRACKED_QUERIES } from '../seoTracking';
import { parseMultiDailyMetrics } from '../gbpPerformance';
import { parseQueryStats, filterTracked } from '../searchConsole';

const row = (o: Partial<Parameters<typeof buildTrends>[0][number]>) => ({
  measured_on: '2026-07-14',
  query: '仙台 ダンススクール',
  target: 'hp',
  position: 17,
  out_of_range: 0,
  ...o,
});

describe('buildTrends', () => {
  it('順位が上がった(数字が小さくなった)ときdeltaが正になる', () => {
    const [t] = buildTrends([
      row({ measured_on: '2026-07-14', position: 17 }),
      row({ measured_on: '2026-08-02', position: 12 }),
    ]);
    expect(t.delta).toBe(5);
    expect(t.direction).toBe('up');
    expect(t.first.position).toBe(17);
    expect(t.latest.position).toBe(12);
  });

  it('順位が下がったらdeltaが負', () => {
    const [t] = buildTrends([
      row({ measured_on: '2026-07-14', position: 12 }),
      row({ measured_on: '2026-08-02', position: 20 }),
    ]);
    expect(t.delta).toBe(-8);
    expect(t.direction).toBe('down');
  });

  it('日付順が入れ替わって入っていても最初と最新を正しく取る', () => {
    const [t] = buildTrends([
      row({ measured_on: '2026-08-02', position: 12 }),
      row({ measured_on: '2026-07-14', position: 17 }),
    ]);
    expect(t.first.on).toBe('2026-07-14');
    expect(t.latest.on).toBe('2026-08-02');
  });

  it('圏外→順位あり は up 扱い(差は測れないのでdeltaはnull)', () => {
    const [t] = buildTrends([
      row({ measured_on: '2026-07-14', position: null, out_of_range: 1 }),
      row({ measured_on: '2026-08-02', position: 30 }),
    ]);
    expect(t.delta).toBeNull();
    expect(t.direction).toBe('up');
  });

  it('順位あり→圏外 は down 扱い', () => {
    const [t] = buildTrends([
      row({ measured_on: '2026-07-14', position: 30 }),
      row({ measured_on: '2026-08-02', position: null, out_of_range: 1 }),
    ]);
    expect(t.direction).toBe('down');
  });

  it('同じクエリでもHPとInstagramは別々に集計する', () => {
    const ts = buildTrends([
      row({ query: '長町 ダンス', target: 'hp', position: 11 }),
      row({ query: '長町 ダンス', target: 'instagram', position: 6 }),
    ]);
    expect(ts).toHaveLength(2);
    expect(ts.map((t) => t.target).sort()).toEqual(['hp', 'instagram']);
  });

  it('本命キーワード(priority 1)がエリア別より上に並ぶ', () => {
    const ts = buildTrends([
      row({ query: '七ヶ浜 ダンス', position: 1 }),
      row({ query: '仙台 ダンススクール', position: 40 }),
    ]);
    expect(ts[0].query).toBe('仙台 ダンススクール');
  });

  it('1回しか測っていなくても壊れない', () => {
    const [t] = buildTrends([row({})]);
    expect(t.delta).toBe(0);
    expect(t.direction).toBe('flat');
  });

  it('空配列でも壊れない', () => {
    expect(buildTrends([])).toEqual([]);
  });
});

describe('formatPosition / rankTier', () => {
  it('圏外を圏外として表示する', () => {
    expect(formatPosition(null)).toBe('圏外');
    expect(formatPosition(12, true)).toBe('圏外');
  });

  it('GSCの小数順位は小数1桁で出す', () => {
    expect(formatPosition(12.34)).toBe('12.3位');
    expect(formatPosition(12)).toBe('12位');
  });

  it('クリックが発生する位置かを区別する', () => {
    expect(rankTier(2)).toBe('top3');
    expect(rankTier(8)).toBe('page1');
    expect(rankTier(12)).toBe('page2');
    expect(rankTier(45)).toBe('far');
    expect(rankTier(null)).toBe('far');
  });
});

describe('parseMultiDailyMetrics (GBP)', () => {
  it('日付×指標のフラットな行に潰す', () => {
    const rows = parseMultiDailyMetrics({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
              timeSeries: {
                datedValues: [
                  { date: { year: 2026, month: 7, day: 1 }, value: '120' },
                  { date: { year: 2026, month: 7, day: 2 }, value: '95' },
                ],
              },
            },
          ],
        },
      ],
    });
    expect(rows).toEqual([
      { metric_date: '2026-07-01', metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 120 },
      { metric_date: '2026-07-02', metric: 'BUSINESS_IMPRESSIONS_MOBILE_MAPS', value: 95 },
    ]);
  });

  it('valueが省略された日は0として扱う(APIは0の日をvalue無しで返す)', () => {
    const rows = parseMultiDailyMetrics({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'CALL_CLICKS',
              timeSeries: { datedValues: [{ date: { year: 2026, month: 7, day: 1 } }] },
            },
          ],
        },
      ],
    });
    expect(rows[0].value).toBe(0);
  });

  it('月日を2桁に揃える', () => {
    const rows = parseMultiDailyMetrics({
      multiDailyMetricTimeSeries: [
        {
          dailyMetricTimeSeries: [
            {
              dailyMetric: 'WEBSITE_CLICKS',
              timeSeries: { datedValues: [{ date: { year: 2026, month: 1, day: 5 }, value: '3' }] },
            },
          ],
        },
      ],
    });
    expect(rows[0].metric_date).toBe('2026-01-05');
  });

  it('空・不正な形でも落ちない', () => {
    expect(parseMultiDailyMetrics({})).toEqual([]);
    expect(parseMultiDailyMetrics(null)).toEqual([]);
    expect(
      parseMultiDailyMetrics({ multiDailyMetricTimeSeries: [{ dailyMetricTimeSeries: [{}] }] })
    ).toEqual([]);
  });
});

describe('parseQueryStats / filterTracked (GSC)', () => {
  it('行をクエリ・順位・表示回数に潰す', () => {
    const rows = parseQueryStats({
      rows: [{ keys: ['仙台 ダンススクール'], position: 12.4, impressions: 210, clicks: 5, ctr: 0.023 }],
    });
    expect(rows[0]).toMatchObject({ query: '仙台 ダンススクール', position: 12.4, impressions: 210 });
  });

  it('keysが無い行は捨てる', () => {
    expect(parseQueryStats({ rows: [{ position: 1 }] })).toEqual([]);
  });

  it('追跡対象のキーワードだけ残す', () => {
    const rows = parseQueryStats({
      rows: [
        { keys: ['仙台 ダンススクール'], position: 12 },
        { keys: ['まったく関係ない語'], position: 3 },
      ],
    });
    const got = filterTracked(rows, TRACKED_QUERIES);
    expect(got).toHaveLength(1);
    expect(got[0].query).toBe('仙台 ダンススクール');
  });

  it('全角スペースの表記ゆれを吸収する', () => {
    const rows = parseQueryStats({ rows: [{ keys: ['仙台　ダンススクール'], position: 12 }] });
    expect(filterTracked(rows, TRACKED_QUERIES)).toHaveLength(1);
  });

  it('部分一致では拾わない(「仙台 ダンススクール 口コミ」は別クエリ)', () => {
    const rows = parseQueryStats({ rows: [{ keys: ['仙台 ダンススクール 口コミ'], position: 4 }] });
    expect(filterTracked(rows, TRACKED_QUERIES)).toHaveLength(0);
  });
});

describe('sumByMonth', () => {
  it('日次を月ごとに合計する', () => {
    const got = sumByMonth([
      { metric_date: '2026-07-01', metric: 'A', value: 10 },
      { metric_date: '2026-07-31', metric: 'A', value: 5 },
      { metric_date: '2026-08-01', metric: 'A', value: 7 },
    ]);
    expect(got).toEqual([
      { month: '2026-07', metric: 'A', total: 15 },
      { month: '2026-08', metric: 'A', total: 7 },
    ]);
  });

  it('月と指標の昇順で返す', () => {
    const got = sumByMonth([
      { metric_date: '2026-08-01', metric: 'B', value: 1 },
      { metric_date: '2026-07-01', metric: 'A', value: 1 },
    ]);
    expect(got.map((r) => r.month)).toEqual(['2026-07', '2026-08']);
  });
});
