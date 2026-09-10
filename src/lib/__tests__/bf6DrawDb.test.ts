import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
  getOne: vi.fn(),
  getAll: vi.fn(),
  execute: vi.fn(),
}));

import { getOne, execute } from '../db';
import { claimBf6Slot } from '../bf6DrawDb';

const mockGetOne = vi.mocked(getOne);
const mockExecute = vi.mocked(execute);

beforeEach(() => {
  vi.resetAllMocks();
});

describe('くじ引きの二度押し(同じ人が同時に2回タップした側)', () => {
  // 実機3台の同時テスト(2026-09-10)で判明:
  // 同じ人が連打すると、負けた側の UPDATE が
  // UNIQUE(division, phase, item_id) に当たって例外になり、
  // 出場者の画面にエラーが出ていた。番号は出さないといけない。
  it('UNIQUE違反になっても、先に取れている自分の枠を返す(エラーにしない)', async () => {
    // 1回目のSELECT: まだ自分の枠は無い(相手がまだ確定していない瞬間)
    mockGetOne.mockResolvedValueOnce(null);
    // UPDATE が UNIQUE 違反で落ちる
    mockExecute.mockRejectedValueOnce(
      new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed: bf_draw.division, bf_draw.phase, bf_draw.item_id')
    );
    // 読み直すと、連打の勝った側が確定させた自分の枠がある
    mockGetOne.mockResolvedValueOnce({ slot_no: 7 } as never);

    const r = await claimBf6Slot('beginner', 'bracket', 42);

    expect(r).not.toBeNull();
    expect(r?.slotNo).toBe(7);
    expect(r?.alreadyDrawn).toBe(true);
  });

  it('UNIQUE違反ではない本当の障害は握りつぶさない', async () => {
    mockGetOne.mockResolvedValueOnce(null);
    mockExecute.mockRejectedValueOnce(new Error('SQLITE_IOERR: disk I/O error'));
    // 読み直しても自分の枠は無い = 本当に取れていない
    mockGetOne.mockResolvedValueOnce(null);

    await expect(claimBf6Slot('beginner', 'bracket', 43)).rejects.toThrow('disk I/O error');
  });
});

describe('くじ引きの正常系', () => {
  it('すでに引いている人は同じ枠を返す(番号が変わらない)', async () => {
    mockGetOne.mockResolvedValueOnce({ slot_no: 3 } as never); // 既存
    mockGetOne.mockResolvedValueOnce({ n: 16 } as never); // ブロック判定用の総数
    const r = await claimBf6Slot('kids', 'block', 10);
    expect(r?.slotNo).toBe(3);
    expect(r?.alreadyDrawn).toBe(true);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('空き枠が無ければ null(満席)', async () => {
    mockGetOne.mockResolvedValueOnce(null); // 自分の枠は無い
    mockExecute.mockResolvedValue({ rowsAffected: 0 } as never); // 取れない
    mockGetOne.mockResolvedValueOnce({ n: 0 } as never); // 空き0
    const r = await claimBf6Slot('beginner', 'bracket', 44);
    expect(r).toBeNull();
  });
});
