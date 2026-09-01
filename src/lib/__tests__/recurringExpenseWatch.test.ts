import { describe, it, expect } from 'vitest';
import {
  findMissingRecurringExpenses,
  normalizeExpenseKey,
  type ExpenseRow,
} from '../recurringExpenseWatch';

const row = (expense_date: string, description: string, amount: number, category = 'システム費'): ExpenseRow => ({
  expense_date,
  description,
  category,
  amount,
});

describe('normalizeExpenseKey', () => {
  it('承認番号とTIDを落として同じ支払いを同一視する', () => {
    expect(normalizeExpenseKey('Visaデビット利用 CANVA* 承認番号：123456 TID：987654321')).toBe(
      normalizeExpenseKey('Visaデビット利用 CANVA* 承認番号：555555 TID：111111111')
    );
  });

  it('重複識別の #2 を落とす', () => {
    expect(normalizeExpenseKey('振込手数料 #2')).toBe(normalizeExpenseKey('振込手数料'));
  });

  it('別の店名は別のキーになる', () => {
    expect(normalizeExpenseKey('ﾘﾍﾞｼﾃｲ')).not.toBe(normalizeExpenseKey('CANVA'));
  });

  it('空やnullは空文字', () => {
    expect(normalizeExpenseKey(null)).toBe('');
    expect(normalizeExpenseKey('')).toBe('');
  });
});

describe('findMissingRecurringExpenses', () => {
  it('リベシティ事件を再現: 3ヶ月続いた固定費が当月だけ無いと検知する', () => {
    const rows = [
      row('2026-04-01', 'ﾘﾍﾞｼﾃｲ', 3300),
      row('2026-05-01', 'ﾘﾍﾞｼﾃｲ', 3300),
      row('2026-06-01', 'ﾘﾍﾞｼﾃｲ', 3300),
    ];
    const missing = findMissingRecurringExpenses(rows, '2026-07');
    expect(missing).toHaveLength(1);
    expect(missing[0].key).toBe('ﾘﾍﾞｼﾃｲ');
    expect(missing[0].typicalAmount).toBe(3300);
    expect(missing[0].lastSeen).toBe('2026-06');
  });

  it('当月にちゃんと出ていれば何も報告しない', () => {
    const rows = [
      row('2026-04-01', 'ﾘﾍﾞｼﾃｲ', 3300),
      row('2026-05-01', 'ﾘﾍﾞｼﾃｲ', 3300),
      row('2026-06-01', 'ﾘﾍﾞｼﾃｲ', 3300),
      row('2026-07-01', 'ﾘﾍﾞｼﾃｲ', 3300),
    ];
    expect(findMissingRecurringExpenses(rows, '2026-07')).toEqual([]);
  });

  it('1回しか出ていない単発の支払いは固定費とみなさない', () => {
    const rows = [row('2026-06-15', 'スポット発注 ｱｸｾｱ', 2200)];
    expect(findMissingRecurringExpenses(rows, '2026-07')).toEqual([]);
  });

  it('表記ゆれ(承認番号違い)があっても同じ固定費として追える', () => {
    const rows = [
      row('2026-04-02', 'Visaデビット利用 CANVA* I04930-4973962 承認番号：111111', 1180),
      row('2026-05-02', 'Visaデビット利用 CANVA* I04961-4230582 承認番号：222222', 1180),
      row('2026-06-02', 'Visaデビット利用 CANVA* I04999-4230111 承認番号：333333', 1180),
    ];
    const missing = findMissingRecurringExpenses(rows, '2026-07');
    expect(missing).toHaveLength(1);
    expect(missing[0].typicalAmount).toBe(1180);
  });

  it('高額なものは対象外(人間が必ず気づくのでノイズになる)', () => {
    const rows = [
      row('2026-04-25', '振込 カ）ハコモノ', 200000),
      row('2026-05-25', '振込 カ）ハコモノ', 200000),
      row('2026-06-25', '振込 カ）ハコモノ', 200000),
    ];
    expect(findMissingRecurringExpenses(rows, '2026-07')).toEqual([]);
  });

  it('年をまたいでも直近3ヶ月を正しく数える', () => {
    const rows = [
      row('2025-11-01', 'ﾘﾍﾞｼﾃｲ', 3300),
      row('2025-12-01', 'ﾘﾍﾞｼﾃｲ', 3300),
    ];
    const missing = findMissingRecurringExpenses(rows, '2026-01');
    expect(missing).toHaveLength(1);
    expect(missing[0].seenMonths).toEqual(['2025-11', '2025-12']);
  });

  it('金額が大きい順に並ぶ', () => {
    const rows = [
      row('2026-04-01', 'ｱﾝﾃﾅ', 500),
      row('2026-05-01', 'ｱﾝﾃﾅ', 500),
      row('2026-04-01', 'ﾃﾞｶｲﾎｳ', 9000),
      row('2026-05-01', 'ﾃﾞｶｲﾎｳ', 9000),
    ];
    const missing = findMissingRecurringExpenses(rows, '2026-06');
    expect(missing.map((m) => m.key)).toEqual(['ﾃﾞｶｲﾎｳ', 'ｱﾝﾃﾅ']);
  });

  it('直近3ヶ月より前にしか無いものは対象外(すでに解約済みを蒸し返さない)', () => {
    const rows = [
      row('2026-01-01', 'ｶｲﾔｸｽﾞﾐ', 1000),
      row('2026-02-01', 'ｶｲﾔｸｽﾞﾐ', 1000),
      row('2026-03-01', 'ｶｲﾔｸｽﾞﾐ', 1000),
    ];
    expect(findMissingRecurringExpenses(rows, '2026-07')).toEqual([]);
  });
});
