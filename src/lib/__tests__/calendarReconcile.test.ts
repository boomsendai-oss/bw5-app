import { describe, it, expect } from 'vitest';
import { reconcileDay, type MasterSlotLite } from '../calendarReconcile';
import type { ResolvedLesson } from '../calendarActuals';

const slot = (o: Partial<MasterSlotLite>): MasterSlotLite => ({
  master_id: 1, date: '2026-08-19', start_time: '18:30', end_time: '20:00',
  instructor_id: 3, studio_id: 12, class_name: 'TARO hiphop 入門初級', ...o,
});
const res = (o: Partial<ResolvedLesson>): ResolvedLesson => ({
  event_id: 'e1', date: '2026-08-19', start: '18:30', end: '20:00', duration_minutes: 90,
  cancelled: false, substitute: false, payable: true, instructor_id: 3, instructor_name: 'TARO',
  studio_id: 90, studio_name: '戦災復興記念館　展示ホール', class_name: 'TARO hiphop 入門初級',
  issues: [], ...o,
});

describe('reconcileDay', () => {
  it('【回帰】給与対象外の予定は、時間が近くても他会場の枠を曖昧にしない', () => {
    // 2026-08-23の事故: GOATのバトル練習会(14:30)がAZUMAの日曜枠と時間が近いだけで
    // 曖昧扱いになり、枠が未書き込み→master展開で埋め戻され開催していない給与が付いた
    const p = reconcileDay(
      [slot({ master_id: 30, start_time: '14:00', studio_id: 4, instructor_id: 6 })],
      [res({ class_name: 'ダンスバトル練習会', payable: false, instructor_id: null, studio_id: 1, start: '14:30' })]
    );
    expect(p.skipped).toHaveLength(0);
    expect(p.removed).toHaveLength(1);            // AZUMAの枠は「開催されなかった」
    expect(p.needsReview).toHaveLength(0);        // 練習会は要確認に積まない
    expect(p.extra).toHaveLength(1);              // 会場は使うのでスタジオ料用に残す
    expect(p.extra[0]).toMatchObject({ instructor_id: null, studio_id: 1 });
  });

  it('読めない予定でも会場が枠と違えば、枠は未開催と判定してよい', () => {
    const p = reconcileDay(
      [slot({ studio_id: 4 })],
      [res({ issues: ['講師が特定できない'], instructor_id: null, studio_id: 1 })]
    );
    expect(p.removed).toHaveLength(1);
    expect(p.skipped).toHaveLength(0);
  });

  it('開始時刻が一致する枠は、カレンダーの会場・講師で上書きする(週替わり会場の反映)', () => {
    const p = reconcileDay([slot({})], [res({})]);
    expect(p.keep).toHaveLength(1);
    // masterの既定は宮城野(12)だが、実際は戦災復興(90)で開催された
    expect(p.keep[0]).toMatchObject({ master_id: 1, studio_id: 90, instructor_id: 3, status: 'scheduled' });
    expect(p.removed).toHaveLength(0);
  });

  it('カレンダーに対応する予定が無い枠は removed にする(休講の埋め戻しを防ぐ)', () => {
    const p = reconcileDay([slot({})], []);
    expect(p.keep).toHaveLength(0);
    expect(p.removed).toEqual([expect.objectContaining({ master_id: 1, date: '2026-08-19', status: 'removed' })]);
  });

  it('休講の予定にマッチした枠も removed にする', () => {
    const p = reconcileDay([slot({})], [res({ cancelled: true })]);
    expect(p.removed).toHaveLength(1);
    expect(p.keep).toHaveLength(0);
  });

  it('要確認(issuesあり)の予定は書き込まず、枠にも触らない ※同じ会場のとき', () => {
    const p = reconcileDay(
      [slot({ studio_id: 90 })],
      [res({ issues: ['講師が特定できない'], instructor_id: null, studio_id: 90 })]
    );
    expect(p.keep).toHaveLength(0);
    expect(p.removed).toHaveLength(0); // 消しもしない = 判断を人に残す
    expect(p.needsReview).toHaveLength(1);
  });

  it('開始時刻がずれていても同じ講師なら同じ枠とみなす(±60分)', () => {
    const p = reconcileDay([slot({ start_time: '18:30' })], [res({ start: '19:00', end: '20:30' })]);
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0]).toMatchObject({ start_time: '19:00', end_time: '20:30' });
  });

  it('どの枠にも対応しない予定は単発(master_id=null)として作る', () => {
    const p = reconcileDay([], [res({ class_name: 'ダンスバトル練習会', instructor_id: 3 })]);
    expect(p.extra).toHaveLength(1);
    expect(p.extra[0]).toMatchObject({ master_id: null, studio_id: 90, instructor_id: 3 });
  });

  it('1つの予定が2つの枠に二重マッチしない', () => {
    const p = reconcileDay(
      [slot({ master_id: 1, start_time: '18:30' }), slot({ master_id: 2, start_time: '18:45' })],
      [res({ start: '18:30' })]
    );
    expect(p.keep).toHaveLength(1);
    expect(p.keep[0].master_id).toBe(1);          // 時刻が近い方が勝つ
    expect(p.removed.map((r) => r.master_id)).toEqual([2]);
  });

  it('別の講師の予定は、時刻が近くても他人の枠を奪わない', () => {
    const p = reconcileDay(
      [slot({ master_id: 1, instructor_id: 3, start_time: '18:30' })],
      [res({ instructor_id: 5, start: '20:00', end: '21:30' })]
    );
    expect(p.keep).toHaveLength(0);
    expect(p.removed).toHaveLength(1);
    expect(p.extra).toHaveLength(1); // 別枠の単発として残る
  });
});
