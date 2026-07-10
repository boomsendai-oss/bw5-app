import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// M9書き込み側 + M10 のテスト: extended_until / withdrawn_at の日付検証とJST基準日。

vi.mock('@/lib/eventAuth', () => ({
  isAuthorized: vi.fn(async () => true),
  unauthorized: vi.fn(() => new Response('unauthorized', { status: 401 })),
}));
vi.mock('@/lib/db', () => ({
  execute: vi.fn(),
  getOne: vi.fn(),
}));
vi.mock('@/lib/membershipRules', () => ({
  assessTicketWithdrawals: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { POST } from '../route';

const mockExecute = vi.mocked(execute);
const mockGetOne = vi.mocked(getOne);

const req = (body: unknown): NextRequest =>
  ({ json: async () => body }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOne.mockResolvedValue(null); // 既存行なし → INSERT 経路
  mockExecute.mockResolvedValue({ rowsAffected: 1 } as never);
  // JST 2026-07-11 05:00 (UTC 2026-07-10 20:00)。旧実装(UTC)なら「今日」は 07-10 になる時刻。
  vi.useFakeTimers({ now: new Date('2026-07-10T20:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/staff/members/withdrawal-candidates (M9 書き込み側)', () => {
  it("extended: '2026/08/01' (スラッシュ形式) は 400", async () => {
    const res = await POST(req({ member_id: 1, action: 'extended', extended_until: '2026/08/01' }));
    expect(res.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("extended: 実在しない '2026-02-30' は 400", async () => {
    const res = await POST(req({ member_id: 1, action: 'extended', extended_until: '2026-02-30' }));
    expect(res.status).toBe(400);
  });

  it('extended: 過去日は 400 (延長として機能しないため)', async () => {
    const res = await POST(req({ member_id: 1, action: 'extended', extended_until: '2026-06-01' }));
    expect(res.status).toBe(400);
  });

  it('extended: 今日(JST)ちょうども 400 (判定は extended_until > today のみスキップ)', async () => {
    const res = await POST(req({ member_id: 1, action: 'extended', extended_until: '2026-07-11' }));
    expect(res.status).toBe(400);
  });

  it('extended: 未来の実在日なら記録される', async () => {
    const res = await POST(req({ member_id: 1, action: 'extended', extended_until: '2026-08-01' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, status: 'extended' });
    expect(mockExecute).toHaveBeenCalledTimes(1);
    const args = mockExecute.mock.calls[0][1] as unknown[];
    expect(args).toContain('2026-08-01');
  });

  it('extended: extended_until 未指定は 400 (従来どおり)', async () => {
    const res = await POST(req({ member_id: 1, action: 'extended' }));
    expect(res.status).toBe(400);
  });

  it('withdrawn: withdrawn_at 省略時は JST の今日が入る (M10: UTCの前日にならない)', async () => {
    const res = await POST(req({ member_id: 1, action: 'withdrawn' }));
    expect(res.status).toBe(200);
    // INSERT 引数: [..., withdrawnAt(idx7), ...]
    const args = mockExecute.mock.calls[0][1] as unknown[];
    expect(args[7]).toBe('2026-07-11'); // 旧実装(UTC slice)だと '2026-07-10' になっていた
  });

  it("withdrawn: 不正な withdrawn_at ('2026/07/11') は 400", async () => {
    const res = await POST(req({ member_id: 1, action: 'withdrawn', withdrawn_at: '2026/07/11' }));
    expect(res.status).toBe(400);
  });

  it('member_id 無しは 400 / 未知の action は 400 (既存挙動の回帰確認)', async () => {
    expect((await POST(req({ action: 'notified' }))).status).toBe(400);
    expect((await POST(req({ member_id: 1, action: 'destroy' }))).status).toBe(400);
  });
});
