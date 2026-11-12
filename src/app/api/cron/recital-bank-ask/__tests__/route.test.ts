// BW6 発表会（段階1）の夜の声かけの定期の入口（/api/cron/recital-bank-ask）の試験。Task 24。
// DB・設定・事実・知らせは全部にせ物（本物の試験DBも、本物の知らせも使わない）。
// getAll のにせ物は SQL の WHERE を読まずに、events([...]) で渡した行をそのまま返す（is_test=1 の行をコードでも外すことを確かめる）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { parseRecitalSettings } from '@/lib/recital';

vi.mock('@/lib/notify', () => ({ notifyTaro: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => ({ getAll: vi.fn(async () => []) }));
vi.mock('@/lib/recitalDb', () => ({ getRecitalSettings: vi.fn() }));
vi.mock('@/lib/recitalBankDb', () => ({ getBankAskFacts: vi.fn() }));

import { notifyTaro } from '@/lib/notify';
import { getAll } from '@/lib/db';
import { getRecitalSettings } from '@/lib/recitalDb';
import { getBankAskFacts } from '@/lib/recitalBankDb';
import { GET, POST } from '../route';

const notify = vi.mocked(notifyTaro);
const SECRET = 'test-cron-secret';
const auth = { 'x-cron-secret': SECRET };
const req = (path: string, headers: Record<string, string>) => new NextRequest(`http://localhost${path}`, { method: 'POST', headers });
const events = (rows: { event_key: string; is_test: number }[]) => vi.mocked(getAll).mockResolvedValue(rows);

const settings = parseRecitalSettings([
  { key: 'pay_open_at', value: '2026-12-15 12:00' }, { key: 'pay_ok_at', value: '2026-12-14 10:00' },
  { key: 'bank_text', value: '（試しの振込先）' }, { key: 'bank_ask_at', value: '19:00,20:30' },
  { key: 'bank_rest_from', value: '2026-12-30' }, { key: 'bank_rest_to', value: '2027-01-03' },
  { key: 'bank_audit_on', value: '2027-02-12' },
]);
const facts = (over: Partial<{ okBatchToday: boolean; reviewCount: number }> = {}) =>
  vi.mocked(getBankAskFacts).mockResolvedValue({ startDate: '2026-12-18', lastShotOn: '2026-12-19', reviewCount: 0, okBatchToday: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  delete process.env.CRON_SECRET_CF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.mocked(getRecitalSettings).mockResolvedValue(settings);
  facts();
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
});

describe('/api/cron/recital-bank-ask', () => {
  it('鍵が無ければ 401', async () => {
    expect((await POST(req('/api/cron/recital-bank-ask?slot=19:00', {}))).status).toBe(401);
    expect(getAll).not.toHaveBeenCalled();
  });
  it('鍵の設定が1つも無ければ、何を送っても 401（閉じる側に倒す）', async () => {
    delete process.env.CRON_SECRET;
    expect((await POST(req('/api/cron/recital-bank-ask?slot=19:00', { 'x-cron-secret': '' }))).status).toBe(401);
  });
  it('slot の形がちがえば 400', async () => {
    expect((await POST(req('/api/cron/recital-bank-ask?slot=7pm', auth))).status).toBe(400);
    expect((await POST(req('/api/cron/recital-bank-ask', auth))).status).toBe(400);
    expect(getAll).not.toHaveBeenCalled();
  });
  it('条件がそろえば TARO に1回（頭は【BOOM】BW6）・試しの発表会には出さない', async () => {
    vi.setSystemTime(new Date('2026-12-20T10:00:00Z'));   // JST 19:00
    events([{ event_key: 'bw6', is_test: 0 }, { event_key: 'bw6-test', is_test: 1 }]);
    facts({ reviewCount: 2 });
    const res = await POST(req('/api/cron/recital-bank-ask?slot=19:00', auth));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ subject: '入金のスクショをお願いします', subjectPrefix: '【BOOM】BW6' });
    expect(notify.mock.calls[0][0].body).toBe('BW6 入金のスクショをお願いします。\n開始日は 12月18日。前に撮ったのは 12月19日。\n見てほしい入金 2件　https://bw5-app.vercel.app/staff/bw6/bank');
    expect(getBankAskFacts).toHaveBeenCalledTimes(1);
    expect(getBankAskFacts).toHaveBeenCalledWith('bw6', expect.any(Date));
    expect(vi.mocked(getAll).mock.calls[0][0]).toMatch(/is_test\s*=\s*0/);
    expect(await res.json()).toEqual({ ok: true, asked: 1 });
  });
  it('GET でも同じ', async () => {
    vi.setSystemTime(new Date('2026-12-20T11:30:00Z'));   // JST 20:30
    events([{ event_key: 'bw6', is_test: 0 }]);
    expect(await (await GET(req('/api/cron/recital-bank-ask?slot=20:30', auth))).json()).toEqual({ ok: true, asked: 1 });
  });
  it('合った束がある日は出さない', async () => {
    vi.setSystemTime(new Date('2026-12-20T10:00:00Z'));
    events([{ event_key: 'bw6', is_test: 0 }]);
    facts({ okBatchToday: true });
    const res = await POST(req('/api/cron/recital-bank-ask?slot=19:00', auth));
    expect(notify).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, asked: 0 });
  });
  it('「払う」の準備中（pay_ok_at が空）は出さない', async () => {
    vi.setSystemTime(new Date('2026-12-20T10:00:00Z'));
    events([{ event_key: 'bw6', is_test: 0 }]);
    vi.mocked(getRecitalSettings).mockResolvedValue({ ...settings, pay_ok_at: null });
    expect(await (await POST(req('/api/cron/recital-bank-ask?slot=19:00', auth))).json()).toEqual({ ok: true, asked: 0 });
    expect(notify).not.toHaveBeenCalled();
  });
});
