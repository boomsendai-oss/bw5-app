import { describe, it, expect } from 'vitest';
import { findRoomConflicts, type RoomUse } from '../roomConflicts';

const use = (o: Partial<RoomUse>): RoomUse => ({
  id: 1, date: '2026-08-23', start_time: '15:00', end_time: '16:00',
  studio_id: 1, studio_name: 'GOATスタジオ', label: 'ベーシックダンス', ...o,
});

describe('findRoomConflicts — 同じ部屋・同じ時間は物理的に不可能', () => {
  it('時間が重なる同室の2件を検出する (2026-08-23の実例)', () => {
    const c = findRoomConflicts([
      use({ id: 533, start_time: '14:30', end_time: '16:00', label: 'ダンスバトル練習会' }),
      use({ id: 391, start_time: '15:00', end_time: '16:00', label: 'ベーシックダンス' }),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ date: '2026-08-23', studio_name: 'GOATスタジオ', overlap: '15:00-16:00' });
  });

  it('部屋が違えば(A/B)重複ではない', () => {
    const c = findRoomConflicts([
      use({ id: 533, start_time: '14:30', end_time: '16:00', studio_id: 2, studio_name: 'GOAT 小スタジオ' }),
      use({ id: 391, start_time: '15:00', end_time: '16:00', studio_id: 1 }),
    ]);
    expect(c).toHaveLength(0);
  });

  it('連続コマ(終了=開始)は重複ではない', () => {
    const c = findRoomConflicts([
      use({ id: 1, start_time: '11:00', end_time: '12:30' }),
      use({ id: 2, start_time: '12:30', end_time: '14:00' }),
    ]);
    expect(c).toHaveLength(0);
  });

  it('日が違えば重複ではない', () => {
    const c = findRoomConflicts([
      use({ id: 1, date: '2026-08-22' }),
      use({ id: 2, date: '2026-08-23' }),
    ]);
    expect(c).toHaveLength(0);
  });

  it('連名で同一枠から2行できたケース(同じ時間・同じ部屋・同じ枠由来)は重複にしない', () => {
    // TARO/KOKEKOの2人体制は lesson_instances が2行になるが物理的には1コマ。
    // dedupe_key(同一の日付+時間+部屋+クラス)が同じなら会場は1回とみなす。
    const c = findRoomConflicts([
      use({ id: 10, label: '長町 HIPHOP クラス' }),
      use({ id: 11, label: '長町 HIPHOP クラス' }),
    ]);
    expect(c).toHaveLength(0);
  });
});
