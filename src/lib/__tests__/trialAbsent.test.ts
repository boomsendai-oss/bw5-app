import { describe, it, expect } from 'vitest';
import { planAbsentCancellations, inferWindowFromRows } from '../trialAbsent';

type Row = { id: number; lstep_id: string | null; reserved_at: string; status: string | null };

const db: Row[] = [
  { id: 1, lstep_id: 'A', reserved_at: '2026-10-03 17:00:00', status: '予約済' }, // 変更前の古い予約(Lstepからは消えた)
  { id: 2, lstep_id: 'A', reserved_at: '2026-10-10 17:00:00', status: '予約済' }, // 変更後
  { id: 3, lstep_id: 'B', reserved_at: '2026-10-10 17:00:00', status: '予約済' },
  { id: 4, lstep_id: 'C', reserved_at: '2026-09-05 15:30:00', status: 'キャンセル' }, // 既にキャンセル=対象外
  { id: 5, lstep_id: null, reserved_at: '2026-09-20 11:00:00', status: '予約済' }, // lstep_id無し=対象外
];

const csvKeys = new Set(['A|2026-10-10 17:00:00', 'B|2026-10-10 17:00:00']);

describe('planAbsentCancellations', () => {
  it('CSVに無くなった予約だけを消失として拾う(キャンセル済み・lstep_id無しは無視)', () => {
    const plan = planAbsentCancellations({ dbRows: db, csvKeys });
    expect(plan.disappeared.map((r) => r.id)).toEqual([1]);
    expect(plan.roster).toBe(3); // id1,2,3
    expect(plan.coverage).toBeCloseTo(2 / 3);
  });

  it('カバレッジが閾値以上かつ消失が少数なら自動キャンセルしてよい', () => {
    const plan = planAbsentCancellations({ dbRows: db, csvKeys, coverageMin: 0.6, autoMax: 5 });
    expect(plan.canAuto).toBe(true);
  });

  it('CSVが部分的(カバレッジ不足)なら自動キャンセルしない=人の確認に回す', () => {
    // CSVがほぼ空 → 3件中0件しか含まれない
    const plan = planAbsentCancellations({ dbRows: db, csvKeys: new Set(), coverageMin: 0.9, autoMax: 5 });
    expect(plan.disappeared.length).toBe(3);
    expect(plan.canAuto).toBe(false);
  });

  it('消失が上限を超えたら自動キャンセルしない', () => {
    const plan = planAbsentCancellations({ dbRows: db, csvKeys, coverageMin: 0.5, autoMax: 0 });
    expect(plan.canAuto).toBe(false);
  });

  it('DBに対象行が無ければカバレッジ1・消失0', () => {
    const plan = planAbsentCancellations({ dbRows: [], csvKeys });
    expect(plan.coverage).toBe(1);
    expect(plan.disappeared).toEqual([]);
    expect(plan.canAuto).toBe(true);
  });
});

describe('inferWindowFromRows', () => {
  it('CSVの予約日時の最小〜最大を窓にする', () => {
    const w = inferWindowFromRows(['2026-10-10 17:00:00', '2026-09-20 11:00:00', '2026-09-27 11:00:00']);
    expect(w).toEqual({ from: '2026-09-20', to: '2026-10-10' });
  });
  it('行が無ければnull', () => {
    expect(inferWindowFromRows([])).toBeNull();
  });
});
