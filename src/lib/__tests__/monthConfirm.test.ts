import { describe, it, expect, vi, beforeEach } from 'vitest';

// DB関数をモック
vi.mock('../db', () => ({
  getOne: vi.fn(),
  getAll: vi.fn(),
  execute: vi.fn(),
}));

import { getOne, getAll, execute } from '../db';
import {
  isMonthConfirmed,
  getConfirmedMonthsSet,
  getMonthConfirmation,
  materializeMonth,
  confirmMonth,
  unconfirmMonth,
} from '../monthConfirm';

const mockGetOne = vi.mocked(getOne);
const mockGetAll = vi.mocked(getAll);
const mockExecute = vi.mocked(execute);

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute.mockResolvedValue({ rowsAffected: 0, lastInsertRowid: BigInt(0) } as never);
});

// ── isMonthConfirmed ──

describe('isMonthConfirmed', () => {
  it('確定済みなら true', async () => {
    mockGetOne.mockResolvedValue({ year_month: '2026-06' });
    expect(await isMonthConfirmed('2026-06')).toBe(true);
  });

  it('未確定なら false', async () => {
    mockGetOne.mockResolvedValue(null);
    expect(await isMonthConfirmed('2026-06')).toBe(false);
  });
});

// ── getConfirmedMonthsSet ──

describe('getConfirmedMonthsSet', () => {
  it('確定済み月のSetを返す', async () => {
    mockGetAll.mockResolvedValue([
      { year_month: '2026-04' },
      { year_month: '2026-05' },
    ]);
    const set = await getConfirmedMonthsSet();
    expect(set.size).toBe(2);
    expect(set.has('2026-04')).toBe(true);
    expect(set.has('2026-05')).toBe(true);
    expect(set.has('2026-06')).toBe(false);
  });

  it('なければ空Set', async () => {
    mockGetAll.mockResolvedValue([]);
    const set = await getConfirmedMonthsSet();
    expect(set.size).toBe(0);
  });
});

// ── getMonthConfirmation ──

describe('getMonthConfirmation', () => {
  it('確定情報を返す', async () => {
    const row = { year_month: '2026-06', confirmed_at: '2026-06-30', materialized_count: 20, note: 'テスト' };
    mockGetOne.mockResolvedValue(row);
    const result = await getMonthConfirmation('2026-06');
    expect(result).toEqual(row);
  });

  it('未確定ならnull', async () => {
    mockGetOne.mockResolvedValue(null);
    expect(await getMonthConfirmation('2026-06')).toBeNull();
  });
});

// ── materializeMonth ──

describe('materializeMonth', () => {
  it('不正な yearMonth でエラー', async () => {
    await expect(materializeMonth('invalid')).rejects.toThrow('invalid yearMonth');
    await expect(materializeMonth('2026-13')).rejects.toThrow('invalid yearMonth');
  });

  it('既存instanceがない場合、masterをINSERTする', async () => {
    // 既存instance: なし
    mockGetAll
      .mockResolvedValueOnce([]) // existingInstances
      .mockResolvedValueOnce([   // masters
        { id: 1, default_day_of_week: 1, default_start_time: '10:00', default_end_time: '11:00', default_studio_id: 1, default_instructor_id: 1 },
      ]);

    const created = await materializeMonth('2026-06');
    // 2026-06の月曜: 1,8,15,22,29 = 5日
    expect(created).toBe(5);
    expect(mockExecute).toHaveBeenCalledTimes(5);
  });

  it('既存instanceがある日はスキップ', async () => {
    mockGetAll
      .mockResolvedValueOnce([
        { master_id: 1, date: '2026-06-01' }, // 月曜6/1にinstance済み
        { master_id: 1, date: '2026-06-08' }, // 6/8も済み
      ])
      .mockResolvedValueOnce([
        { id: 1, default_day_of_week: 1, default_start_time: '10:00', default_end_time: '11:00', default_studio_id: 1, default_instructor_id: 1 },
      ]);

    const created = await materializeMonth('2026-06');
    // 5日 - 2日(既存) = 3日分INSERT
    expect(created).toBe(3);
  });

  it('start_time/end_time未設定のmasterはスキップ', async () => {
    mockGetAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, default_day_of_week: 1, default_start_time: null, default_end_time: null, default_studio_id: 1, default_instructor_id: 1 },
      ]);

    const created = await materializeMonth('2026-06');
    expect(created).toBe(0);
  });
});

// ── confirmMonth ──

describe('confirmMonth', () => {
  it('既に確定済みなら materialize せず冪等に返す', async () => {
    mockGetOne.mockResolvedValue({ year_month: '2026-06' });
    const result = await confirmMonth('2026-06');
    expect(result).toEqual({ created: 0, alreadyConfirmed: true });
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('未確定なら materialize して記録', async () => {
    // isMonthConfirmed → false
    mockGetOne.mockResolvedValue(null);
    // materializeMonth: instance=0, masters=1(火曜)
    mockGetAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 1, default_day_of_week: 2, default_start_time: '14:00', default_end_time: '15:00', default_studio_id: 1, default_instructor_id: 1 },
      ]);

    const result = await confirmMonth('2026-06', 'テスト確定');
    // 2026-06の火曜: 2,9,16,23,30 = 5日
    expect(result.created).toBe(5);
    expect(result.alreadyConfirmed).toBe(false);
    // 5回INSERT + 1回month_confirmations INSERT = 6回
    expect(mockExecute).toHaveBeenCalledTimes(6);
  });
});

// ── unconfirmMonth ──

describe('unconfirmMonth', () => {
  it('不正な yearMonth でエラー', async () => {
    await expect(unconfirmMonth('bad')).rejects.toThrow('invalid yearMonth');
  });

  it('auto_materialized=1のinstanceを削除し、確定レコードを削除', async () => {
    await unconfirmMonth('2026-06');
    expect(mockExecute).toHaveBeenCalledTimes(2);
    // 1回目: DELETE instances
    expect(mockExecute.mock.calls[0][0]).toContain('DELETE FROM lesson_instances');
    expect(mockExecute.mock.calls[0][0]).toContain('auto_materialized = 1');
    // 2回目: DELETE month_confirmations
    expect(mockExecute.mock.calls[1][0]).toContain('DELETE FROM month_confirmations');
  });
});
