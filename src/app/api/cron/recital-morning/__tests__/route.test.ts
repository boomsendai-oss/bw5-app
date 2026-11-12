// BW6 発表会（段階1）の朝8時の定期の入口（/api/cron/recital-morning）の試験。Task 24。
// 朝の「ア」＝夜に待たせた振込の確認メールを出す（flushWaitingMails）と、1/4 の休み明けの声かけ。
// DB・設定・事実・知らせ・メールは全部にせ物（本物のメールは出さない）。
// getAll のにせ物は SQL の WHERE を読まずに、events([...]) で渡した行をそのまま返す。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { parseRecitalSettings } from '@/lib/recital';

vi.mock('@/lib/notify', () => ({ notifyTaro: vi.fn(async () => undefined) }));
vi.mock('@/lib/db', () => ({ getAll: vi.fn(async () => []) }));
vi.mock('@/lib/recitalDb', () => ({ getRecitalSettings: vi.fn() }));
vi.mock('@/lib/recitalBankDb', () => ({ getBankAskFacts: vi.fn() }));
vi.mock('@/lib/recitalMail', () => ({ flushWaitingMails: vi.fn() }));

import { notifyTaro } from '@/lib/notify';
import { getAll } from '@/lib/db';
import { getRecitalSettings } from '@/lib/recitalDb';
import { getBankAskFacts } from '@/lib/recitalBankDb';
import { flushWaitingMails } from '@/lib/recitalMail';
import { GET, POST } from '../route';

const notify = vi.mocked(notifyTaro);
const flush = vi.mocked(flushWaitingMails);
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
  delete process.env.CRON_SECRET_CF;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.mocked(getRecitalSettings).mockResolvedValue(settings);
  vi.mocked(getBankAskFacts).mockResolvedValue({ startDate: '2026-12-29', lastShotOn: '2026-12-29', reviewCount: 1, okBatchToday: false });
  flush.mockResolvedValue({ sent: 2, failed: 1 });
  events([{ event_key: 'bw6', is_test: 0 }, { event_key: 'bw6-test', is_test: 1 }]);
});
afterEach(() => {
  vi.useRealTimers();
  delete process.env.CRON_SECRET;
});

describe('/api/cron/recital-morning', () => {
  it('鍵が無ければ 401（メールも出さない）', async () => {
    expect((await POST(req('/api/cron/recital-morning', {}))).status).toBe(401);
    expect(flush).not.toHaveBeenCalled();
  });
  it('発表会ごとに flushWaitingMails を呼ぶ（試しの発表会も）・ふだんの朝は声かけしない', async () => {
    const now = new Date('2026-12-20T23:00:00Z');   // JST 12/21 8:00
    vi.setSystemTime(now);
    const res = await POST(req('/api/cron/recital-morning', auth));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenCalledWith('bw6', now);
    expect(flush).toHaveBeenCalledWith('bw6-test', now);
    expect(notify).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, sent: 4, failed: 2, asked: 0 });
  });
  it('JST 1/4 8:00 の時だけ、休み明けの文で1回（試しの発表会には出さない）', async () => {
    vi.setSystemTime(new Date('2027-01-03T23:00:00Z'));
    const res = await POST(req('/api/cron/recital-morning', auth));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toEqual({
      subject: '入金のスクショをお願いします（休み明け）',
      body: '休みの間の分を、お願いします。\nGMO アプリの「入出金明細」（一覧の画面）を撮って送ってください。\n開始日を 12月29日 にして、まとめて撮ってください。',
      subjectPrefix: '【BOOM】BW6',
    });
    expect(getBankAskFacts).toHaveBeenCalledWith('bw6', expect.any(Date));
    expect(getBankAskFacts).not.toHaveBeenCalledWith('bw6-test', expect.anything());
    expect(await res.json()).toEqual({ ok: true, sent: 4, failed: 2, asked: 1 });
  });
  it('追い打ち（?retry=1）は flush だけで、1/4 でも声かけしない', async () => {
    vi.setSystemTime(new Date('2027-01-03T23:05:00Z'));
    const res = await GET(req('/api/cron/recital-morning?retry=1', auth));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
    expect(getBankAskFacts).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ ok: true, sent: 4, failed: 2, asked: 0 });
  });
  it('1つの発表会の flush が throw しても、ほかは続ける（ログに中身を出さない）', async () => {
    vi.setSystemTime(new Date('2026-12-20T23:00:00Z'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    flush.mockRejectedValueOnce(new Error('smtp: 550 someone@example.com unknown'));
    const res = await POST(req('/api/cron/recital-morning', auth));
    expect(flush).toHaveBeenCalledTimes(2);
    expect(await res.json()).toEqual({ ok: true, sent: 2, failed: 1, asked: 0 });
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/example\.com/);
    err.mockRestore();
  });
  it('1つの発表会の声かけが throw しても、ほかの発表会は続ける・500 にしない（ログは recital_ の決まった言葉だけ）', async () => {
    vi.setSystemTime(new Date('2027-01-03T23:00:00Z'));   // JST 1/4 8:00
    events([{ event_key: 'bw6', is_test: 0 }, { event_key: 'bw6-other', is_test: 0 }]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(getBankAskFacts).mockRejectedValueOnce(new Error('db: ヤマダハナコ someone@example.com'));
    const res = await POST(req('/api/cron/recital-morning', auth));
    expect(res.status).toBe(200);
    expect(getBankAskFacts).toHaveBeenCalledWith('bw6-other', expect.any(Date));
    expect(notify).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ ok: true, sent: 4, failed: 2, asked: 1 });
    expect(err).toHaveBeenCalled();
    const logged = err.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/example\.com|ヤマダ/);
    err.mockRestore();
  });
  it('声かけの知らせが recital_ の決まった言葉で throw したら、その言葉はログに出す', async () => {
    vi.setSystemTime(new Date('2027-01-03T23:00:00Z'));
    events([{ event_key: 'bw6', is_test: 0 }]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    notify.mockRejectedValueOnce(new Error('recital_notify:failed'));
    const res = await POST(req('/api/cron/recital-morning', auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, sent: 2, failed: 1, asked: 0 });
    expect(err.mock.calls.flat().join(' ')).toContain('recital_notify:failed');
    err.mockRestore();
  });
});
