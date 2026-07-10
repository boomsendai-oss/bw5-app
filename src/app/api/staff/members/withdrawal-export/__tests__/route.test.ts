import { describe, it, expect, vi, beforeEach } from 'vitest';

// B-3 (技術的負債改修設計 2026-07-06): 退会CSVの突合テスト。
// 「任意の会員IDを渡すと退会CSVに載る」経路が塞がっていることを確認する。

vi.mock('@/lib/eventAuth', () => ({
  isAuthorized: vi.fn(async () => true),
  unauthorized: vi.fn(() => new Response('unauthorized', { status: 401 })),
}));
vi.mock('@/lib/db', () => ({
  getAll: vi.fn(),
}));
vi.mock('@/lib/membershipRules', () => ({
  assessTicketWithdrawals: vi.fn(),
}));

import type { NextRequest } from 'next/server';
import { getAll } from '@/lib/db';
import { assessTicketWithdrawals } from '@/lib/membershipRules';
import { POST } from '../route';

const mockGetAll = vi.mocked(getAll);
const mockAssess = vi.mocked(assessTicketWithdrawals);

const req = (body: unknown): NextRequest =>
  ({ json: async () => body }) as unknown as NextRequest;

/** assessTicketWithdrawals の返り値スタブ (candidates の member_id だけ意味を持つ) */
const assessment = (candidateIds: number[]) =>
  ({
    params: {},
    candidates: candidateIds.map((id) => ({ member_id: id })),
    pre_notice: [],
    family_review: [],
    warnings: [],
  }) as unknown as Awaited<ReturnType<typeof assessTicketWithdrawals>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/staff/members/withdrawal-export (B-3 突合)', () => {
  it('対象外の会員IDが混ざっていたら 400 で全体拒否する(部分成功にしない)', async () => {
    mockAssess.mockResolvedValue(assessment([10, 11]));
    // withdrawal_notices (notified/withdrawn) は空
    mockGetAll.mockResolvedValueOnce([]);

    const res = await POST(req({ member_ids: [10, 999] }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.invalid_member_ids).toEqual([999]);
    // 突合で弾かれた場合、boom_members の SELECT まで到達しない(=CSVを一切作らない)
    expect(mockGetAll).toHaveBeenCalledTimes(1);
  });

  it('候補でも通知済みでもない現役会員のみの指定も 400', async () => {
    mockAssess.mockResolvedValue(assessment([10]));
    mockGetAll.mockResolvedValueOnce([]); // notices なし

    const res = await POST(req({ member_ids: [55] }));
    expect(res.status).toBe(400);
    expect((await res.json()).invalid_member_ids).toEqual([55]);
  });

  it('通知済み(notified)のIDは現候補から外れていても許可される', async () => {
    mockAssess.mockResolvedValue(assessment([10]));
    mockGetAll
      .mockResolvedValueOnce([{ member_id: 20 }]) // notices: notified
      .mockResolvedValueOnce([
        { email: 'a@example.com', hacomono_kaiin_no: '0020', plan_code: 'T4', full_name: '山田 花子' },
      ]);

    const res = await POST(req({ member_ids: [20], withdrawal_date: '2026-07-15' }));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('山田 花子');
  });

  it('正当な候補IDなら full_name 参考列と件数サマリ行付きのCSVを返す', async () => {
    mockAssess.mockResolvedValue(assessment([10, 11]));
    mockGetAll
      .mockResolvedValueOnce([]) // notices
      .mockResolvedValueOnce([
        { email: 'a@example.com', hacomono_kaiin_no: '0010', plan_code: 'T4', full_name: '田中 太郎' },
        { email: null, hacomono_kaiin_no: '0011', plan_code: 'T8', full_name: '佐藤 次郎' },
      ]);

    const res = await POST(req({ member_ids: [10, 11], withdrawal_date: '2026-07-15' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    const text = await res.text();
    // ヘッダに参考列
    expect(text).toContain('氏名(参考)');
    // full_name がCSV本体に出力される (B-3: SELECT済みなのに未出力だった)
    expect(text).toContain('田中 太郎');
    expect(text).toContain('佐藤 次郎');
    // 終了日・退会手続き日時
    expect(text).toContain('"2026-07-15"');
    expect(text).toContain('"2026-07-15 00:00:00"');
    // 末尾サマリ行
    expect(text).toContain('# 合計 2件');
  });

  it('member_ids が空なら 400', async () => {
    const res = await POST(req({ member_ids: [] }));
    expect(res.status).toBe(400);
  });

  it('withdrawal_date が不正形式(実在しない日付含む)なら 400', async () => {
    for (const bad of ['2026/07/15', '2026-7-5', '2026-02-30', 'today']) {
      const res = await POST(req({ member_ids: [10], withdrawal_date: bad }));
      expect(res.status, `withdrawal_date=${bad}`).toBe(400);
    }
  });

  it('整数でない member_ids はフィルタされ、残りが空なら 400', async () => {
    const res = await POST(req({ member_ids: ['10; DROP TABLE', 1.5, null] }));
    expect(res.status).toBe(400);
  });
});
