import { describe, it, expect, vi, beforeEach } from 'vitest';

// M15: 手動編集(振替)instance は master期間外でも出力される。
// buildLessonsForMonths は Googleカレンダー同期(googleCalendar.ts)と
// HACOMONO出力(hacomonoExport.ts)の共通経路のため、両方に効く。

vi.mock('../db', () => ({
  getAll: vi.fn(),
  getOne: vi.fn(),
  execute: vi.fn(),
}));
vi.mock('../monthConfirm', () => ({
  getConfirmedMonthsSet: vi.fn(async () => new Set<string>()),
}));

import { getAll } from '../db';
import { buildLessonsForMonths, durationFromTimes } from '../scheduleExport';

const mockGetAll = vi.mocked(getAll);

const instance = (over: Record<string, unknown>) => ({
  id: 1,
  master_id: 10,
  date: '2026-07-15',
  start_time: '18:00',
  end_time: '19:00',
  studio_id: null,
  instructor_id: null,
  status: 'scheduled',
  auto_materialized: 0,
  notes: null,
  master_class_name: 'HIPHOP初級',
  studio_name: '長町',
  instructor_name: 'KEIKO',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

/** buildLessonsForMonths 内の getAll 呼び出し順: instances → masters → dateRange */
function stubDb(args: {
  instances: unknown[];
  masters?: unknown[];
  dateRanges?: unknown[];
}) {
  mockGetAll
    .mockResolvedValueOnce(args.instances)
    .mockResolvedValueOnce(args.masters ?? [])
    .mockResolvedValueOnce(args.dateRanges ?? []);
}

describe('buildLessonsForMonths (M15)', () => {
  it('手動編集instance(auto_materialized=0)は master期間外でも出力される (振替の消失防止)', async () => {
    stubDb({
      instances: [
        // master 10 は 6/30 で終了しているが、7/20 へ手動振替した decision は残す
        instance({ id: 2, date: '2026-07-20', auto_materialized: 0 }),
      ],
      dateRanges: [{ id: 10, start_date: null, end_date: '2026-06-30' }],
    });
    const lessons = await buildLessonsForMonths(1, '2026-07');
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({ instance_id: 2, date: '2026-07-20', source: 'instance' });
  });

  it('自動実体化instance(auto_materialized=1)は master期間外なら従来どおり抑止', async () => {
    stubDb({
      instances: [instance({ id: 1, date: '2026-07-15', auto_materialized: 1 })],
      dateRanges: [{ id: 10, start_date: null, end_date: '2026-06-30' }],
    });
    const lessons = await buildLessonsForMonths(1, '2026-07');
    expect(lessons).toHaveLength(0);
  });

  it('期間内なら自動実体化instanceも出力される (回帰確認)', async () => {
    stubDb({
      instances: [instance({ id: 3, date: '2026-07-15', auto_materialized: 1 })],
      dateRanges: [{ id: 10, start_date: null, end_date: '2026-07-31' }],
    });
    const lessons = await buildLessonsForMonths(1, '2026-07');
    expect(lessons).toHaveLength(1);
  });

  it("status='removed' は auto_materialized に関係なく出力しない", async () => {
    stubDb({
      instances: [instance({ id: 4, status: 'removed', auto_materialized: 0 })],
    });
    const lessons = await buildLessonsForMonths(1, '2026-07');
    expect(lessons).toHaveLength(0);
  });

  it('休講(cancelled)の手動instanceは期間外でも cancelled として出力される', async () => {
    stubDb({
      instances: [instance({ id: 5, date: '2026-07-20', status: 'cancelled', auto_materialized: 0 })],
      dateRanges: [{ id: 10, start_date: null, end_date: '2026-06-30' }],
    });
    const lessons = await buildLessonsForMonths(1, '2026-07');
    expect(lessons).toHaveLength(1);
    expect(lessons[0].status).toBe('cancelled');
  });
});

describe('durationFromTimes', () => {
  it('HH:MM 2つから所要分', () => {
    expect(durationFromTimes('18:00', '19:30')).toBe(90);
  });
  it('不正・逆転は null', () => {
    expect(durationFromTimes('19:00', '18:00')).toBeNull();
    expect(durationFromTimes(null, '18:00')).toBeNull();
  });
});
