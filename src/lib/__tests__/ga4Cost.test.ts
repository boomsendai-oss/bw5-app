import { describe, it, expect } from 'vitest';
import { monthRange, sumAdRows, formatAdCost } from '../ga4';

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

describe('formatAdCost', () => {
  it('JPYは¥つき・整数に丸めて表示する', () => {
    expect(formatAdCost(26730, 'JPY')).toBe('¥26,730');
    expect(formatAdCost(26730.6, 'JPY')).toBe('¥26,731');
  });
  it('JPY以外は通貨コードを併記し小数第2位まで表示する', () => {
    expect(formatAdCost(160.54, 'USD')).toBe('USD 160.54');
    expect(formatAdCost(160.5, 'USD')).toBe('USD 160.50');
  });
  it('通貨コードが不明/空の場合はコードを付けず数値をそのまま表示する', () => {
    expect(formatAdCost(5, '')).toBe('5');
  });
});
