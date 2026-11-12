// BW6 発表会（段階1）の入金の束の入口（POST /api/staff/recital/bank-rows）の試験。Task 27。
// 認証と recitalBankDb は mock する（DB にさわらない）。名前・番号は作り物。
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { isAuthorized, unauthorized } = vi.hoisted(() => ({
  isAuthorized: vi.fn(async (req: unknown) => req !== undefined),
  unauthorized: vi.fn(() => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
}));
vi.mock('@/lib/eventAuth', () => ({
  isAuthorized,
  unauthorized,
  withAuth:
    (h: (req: unknown, ctx?: unknown) => Promise<Response>) =>
    async (req: unknown, ctx?: unknown) =>
      (await isAuthorized(req)) ? h(req, ctx) : unauthorized(),
}));
vi.mock('@/lib/recitalBankDb', () => ({ ingestBankBatch: vi.fn() }));

import type { NextRequest } from 'next/server';
import { ingestBankBatch as ingestReal } from '@/lib/recitalBankDb';
import { POST } from '../route';

const ingestBankBatch = vi.mocked(ingestReal);
const req = (body: unknown): NextRequest => ({ json: async () => body }) as unknown as NextRequest;

const goodBatch = {
  event_key: 't-route',
  source: 'chat',
  shot_on: '2026-12-16',
  range_from: '2026-12-14',
  range_to: '2026-12-16',
  images: 1,
  account: '円普通預金',
  rows: [{ pos: '1-1', date: '12/16', dir: 'out', amount: 1000, balance: 152500, kind: 'debit', desc: '', cut: false, unread: '' }],
};
const result = {
  mode: 'commit', check: { ok: true }, read_rows: 1, inserted: 1, existing: 0, rejected: 0, auto_matched: 0, flagged: 0, review: {}, needs_first_ok: false,
} as Awaited<ReturnType<typeof ingestReal>>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/staff/recital/bank-rows', () => {
  it('スタッフでなければ 401', async () => {
    isAuthorized.mockResolvedValueOnce(false);
    expect((await POST(req({}))).status).toBe(401);
    expect(ingestBankBatch).not.toHaveBeenCalled();
  });
  it('mode が dry/commit でない・形が合わない → 400、ingestBankBatch を呼ばない', async () => {
    expect((await POST(req({ mode: 'x', batch: goodBatch }))).status).toBe(400);
    expect((await POST(req({ mode: 'dry', batch: { ...goodBatch, source: 'x' } }))).status).toBe(400);
    expect(ingestBankBatch).not.toHaveBeenCalled();
  });
  it('本文が JSON でない → 400', async () => {
    const bad = { json: async () => { throw new SyntaxError('bad json'); } } as unknown as NextRequest;
    expect((await POST(bad)).status).toBe(400);
    expect(ingestBankBatch).not.toHaveBeenCalled();
  });
  it('合えば ingestBankBatch(batch, mode, imported_by) の結果をそのまま返す', async () => {
    ingestBankBatch.mockResolvedValueOnce(result);
    const res = await POST(req({ mode: 'commit', imported_by: 'Claude', batch: goodBatch }));
    expect(res.status).toBe(200);
    expect(ingestBankBatch).toHaveBeenCalledWith(expect.objectContaining({ event_key: goodBatch.event_key }), 'commit', 'Claude');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await res.json()).toEqual(result);
  });
  it('imported_by が無ければ chat・40字をこえれば40字に切る', async () => {
    ingestBankBatch.mockResolvedValue(result);
    await POST(req({ mode: 'dry', batch: goodBatch }));
    expect(ingestBankBatch).toHaveBeenLastCalledWith(expect.anything(), 'dry', 'chat');
    await POST(req({ mode: 'dry', imported_by: 'あ'.repeat(50), batch: goodBatch }));
    expect(ingestBankBatch).toHaveBeenLastCalledWith(expect.anything(), 'dry', 'あ'.repeat(40));
  });
  it('発表会が無い → 404', async () => {
    ingestBankBatch.mockRejectedValueOnce(new Error('no_event'));
    expect((await POST(req({ mode: 'dry', batch: goodBatch }))).status).toBe(404);
  });
  it('ほかの失敗 → 500、中身を返さない', async () => {
    ingestBankBatch.mockRejectedValueOnce(new Error('ヤマダ 1234567'));
    const res = await POST(req({ mode: 'dry', batch: goodBatch }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'failed' });
  });
});
