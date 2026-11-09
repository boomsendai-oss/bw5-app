import { describe, it, expect, vi, beforeEach } from 'vitest';

// 【回帰】2026-10-11: 代講(担当未登録)の3コマに lesson_instances が無く、
// 給与計算のマスタ補完が元の担当に給与を付けた。
// カレンダー同期が settings に記録した「代講で保留中の枠」は、補完で元の担当に払わず
// 給与計算画面の warnings に「要確認」として出す。

vi.mock('../db', () => ({
  getAll: vi.fn(),
  getOne: vi.fn(),
  execute: vi.fn(),
  withWriteTx: vi.fn(),
}));
vi.mock('../monthConfirm', () => ({
  isMonthConfirmed: vi.fn(async () => false),
}));

import { getAll, getOne } from '../db';
import { isMonthConfirmed } from '../monthConfirm';
import { calculatePayrollForMonth } from '../payroll';
import { substituteWarnings } from '../monthlyClose';

const mockGetAll = vi.mocked(getAll);
const mockGetOne = vi.mocked(getOne);

// 日曜(0)のキッズ枠。2026-10 の日曜は 4, 11, 18, 25
const master = {
  id: 1, class_name: 'キッズHIPHOP入門', default_day_of_week: 0,
  default_start_time: '12:15', default_end_time: '13:15',
  duration_minutes: 60, override_rate: null,
  default_instructor_id: 5, default_studio_id: 1, studio_name: 'GOAT',
  start_date: null, end_date: null,
};

function setupDb(pendingValue: string | null) {
  mockGetAll.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM instructors')) return [{ id: 5, name: 'X', salary_type: 'per_lesson', monthly_fixed_amount: null }] as never;
    if (sql.includes('FROM instructor_rates')) return [{ instructor_id: 5, duration_minutes: 60, rate: 4000 }] as never;
    if (sql.includes('FROM instructor_transit_fees')) return [] as never;
    if (sql.includes('FROM lesson_instances')) return [] as never;
    if (sql.includes('FROM lesson_master')) return [master] as never;
    return [] as never;
  });
  mockGetOne.mockImplementation(async (sql: string, args?: unknown[]) => {
    if (sql.includes('FROM settings') && args?.[0] === 'calendar_substitute_pending:2026-10') {
      return (pendingValue == null ? null : { value: pendingValue }) as never;
    }
    return null as never;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isMonthConfirmed).mockResolvedValue(false);
});

describe('calculatePayrollForMonth: 代講で保留中の枠', () => {
  it('【回帰】保留中の枠は元の担当に給与を付けず held_substitute に出す', async () => {
    setupDb(JSON.stringify([{ master_id: 1, date: '2026-10-11', class_name: 'キッズHIPHOP入門' }]));
    const r = await calculatePayrollForMonth('2026-10');
    const x = r.results.find((p) => p.instructor_id === 5)!;
    expect(x.lines.map((l) => l.lesson_date)).toEqual(['2026-10-04', '2026-10-18', '2026-10-25']);
    expect(x.total_lesson_amount).toBe(12000);
    expect(r.held_substitute).toEqual([
      { master_id: 1, date: '2026-10-11', class_name: 'キッズHIPHOP入門', default_instructor_id: 5 },
    ]);

    const w = substituteWarnings(r.held_substitute, r.results);
    expect(w).toHaveLength(1);
    expect(w[0].instructor_id).toBe(5);
    expect(w[0].reason).toContain('要確認: 10/11 キッズHIPHOP入門 は代講の予定だが担当が未登録');
    expect(w[0].reason).toContain('給与¥0扱い');
  });

  it('記録が無い・壊れている月は従来どおり全部補完する', async () => {
    setupDb(null);
    const r = await calculatePayrollForMonth('2026-10');
    expect(r.results.find((p) => p.instructor_id === 5)!.lines).toHaveLength(4);
    expect(r.held_substitute).toEqual([]);

    setupDb('broken');
    const r2 = await calculatePayrollForMonth('2026-10');
    expect(r2.results.find((p) => p.instructor_id === 5)!.lines).toHaveLength(4);
  });

  it('月確定済み(month_confirmations)の月は補完も保留判定もしない', async () => {
    vi.mocked(isMonthConfirmed).mockResolvedValue(true);
    setupDb(JSON.stringify([{ master_id: 1, date: '2026-10-11', class_name: 'キッズHIPHOP入門' }]));
    const r = await calculatePayrollForMonth('2026-10');
    expect(r.results.find((p) => p.instructor_id === 5)!.lines).toHaveLength(0);
    expect(r.held_substitute).toEqual([]);
  });
});

describe('substituteWarnings', () => {
  it('元の担当が居ない枠は「担当未登録」として出す', () => {
    const w = substituteWarnings(
      [{ master_id: 9, date: '2026-11-02', class_name: 'HOUSE', default_instructor_id: null }],
      [],
    );
    expect(w).toEqual([{ instructor_id: 0, instructor_name: '担当未登録', reason: expect.stringContaining('要確認: 11/2 HOUSE') }]);
  });
});
