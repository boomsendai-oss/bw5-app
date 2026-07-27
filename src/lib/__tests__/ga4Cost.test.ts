import { describe, it, expect } from 'vitest';
import { monthRange, sumAdRows } from '../ga4';

describe('monthRange', () => {
  it('月初と月末を返す', () => {
    expect(monthRange('2026-07')).toEqual({ startDate: '2026-07-01', endDate: '2026-07-31' });
  });
  it('2月・うるう年を正しく扱う', () => {
    expect(monthRange('2026-02')).toEqual({ startDate: '2026-02-01', endDate: '2026-02-28' });
    expect(monthRange('2028-02')).toEqual({ startDate: '2028-02-01', endDate: '2028-02-29' });
  });
});

describe('sumAdRows', () => {
  it('日次の行を合計する', () => {
    const rows = [
      { metricValues: [{ value: '12.31' }, { value: '22' }] },
      { metricValues: [{ value: '7.93' }, { value: '14' }] },
    ];
    expect(sumAdRows(rows)).toEqual({ cost: 20.24, clicks: 36 });
  });
  it('行が無ければゼロ', () => {
    expect(sumAdRows([])).toEqual({ cost: 0, clicks: 0 });
    expect(sumAdRows(undefined)).toEqual({ cost: 0, clicks: 0 });
  });
});
