import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// M11(b) + M10: 休眠おかえり配信リストの新規入会保護とJST基準日。

vi.mock('@/lib/eventAuth', () => ({
  isAuthorized: vi.fn(async () => true),
  unauthorized: vi.fn(() => new Response('unauthorized', { status: 401 })),
}));
vi.mock('@/lib/db', () => ({
  getAll: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { getAll } from '@/lib/db';
import { GET } from '../route';

const mockGetAll = vi.mocked(getAll);

const req = (qs = ''): NextRequest =>
  ({ url: `http://localhost/api/staff/members/dormant-outreach${qs}` }) as unknown as NextRequest;

beforeEach(() => {
  vi.clearAllMocks();
  // JST 2026-07-11 05:00 (UTC 2026-07-10 20:00)
  vi.useFakeTimers({ now: new Date('2026-07-10T20:00:00Z') });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/staff/members/dormant-outreach (M11b)', () => {
  it('SQLに enrolled_at IS NOT NULL + 入会90日超の条件が入る (新規/入会日不明の保護)', async () => {
    mockGetAll.mockResolvedValue([]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const [sql, args] = mockGetAll.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('enrolled_at IS NOT NULL');
    expect(sql).toContain('m.enrolled_at < ?');
    // JST今日=2026-07-11 の90日前 = 2026-04-12 (UTC基準なら 04-11 になってしまう)
    expect(args).toEqual(['2026-04-12']);
    expect((await res.json()).enrolled_before).toBe('2026-04-12');
  });

  it('days パラメータが入会日カットオフにも効く', async () => {
    mockGetAll.mockResolvedValue([]);
    await GET(req('?days=30'));
    const [, args] = mockGetAll.mock.calls[0] as [string, unknown[]];
    expect(args).toEqual(['2026-06-11']);
  });

  it('経過日数はJST基準で丸一日単位・閾値ちょうどは対象に含む', async () => {
    mockGetAll.mockResolvedValue([
      // 90日前ちょうど (2026-04-12) → days_since=90 → 対象
      { member_id: 1, full_name: 'A', full_name_kana: 'ア', has_email: 1, last_checkin: '2026-04-12', checkin_count: 3, lstep_id_self: null, line_links: 0 },
      // 89日前 (2026-04-13) → 対象外
      { member_id: 2, full_name: 'B', full_name_kana: 'イ', has_email: 0, last_checkin: '2026-04-13', checkin_count: 2, lstep_id_self: 'u1', line_links: 1 },
      // 未受講 (checkin 0) → 対象 (入会90日超はSQL側で担保済み)
      { member_id: 3, full_name: 'C', full_name_kana: 'ウ', has_email: 0, last_checkin: null, checkin_count: 0, lstep_id_self: null, line_links: 0 },
    ]);
    const res = await GET(req());
    const json = await res.json();
    expect(json.total).toBe(2);
    const ids = json.members.map((m: { member_id: number }) => m.member_id);
    expect(ids).toContain(1);
    expect(ids).toContain(3);
    expect(ids).not.toContain(2);
    const m1 = json.members.find((m: { member_id: number }) => m.member_id === 1);
    expect(m1.days_since_checkin).toBe(90);
  });
});
