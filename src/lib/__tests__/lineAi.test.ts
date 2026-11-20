import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';

const groups = new Map<string, string>();
const jobs: unknown[][] = [];
vi.mock('@/lib/db', () => ({
  execute: vi.fn(async (sql: string, args: unknown[]) => {
    if (sql.includes('INSERT') && sql.includes('line_ai_groups')) {
      const id = String(args[0]);
      if (!groups.has(id) || (!sql.includes('IGNORE') && groups.get(id) !== 'approved')) groups.set(id, 'pending');
      return { rowsAffected: 1 };
    }
    if (sql.includes("status = 'left'")) { groups.set(String(args[1]), 'left'); return { rowsAffected: 1 }; }
    if (sql.includes('line_ai_files')) { jobs.push(['file', ...args]); return { rowsAffected: 1 }; }
    if (sql.includes('line_ai_jobs')) {
      if (jobs.some((j) => j[0] && j[0] === args[0])) return { rowsAffected: 0 };
      jobs.push(args); return { rowsAffected: 1 };
    }
    return { rowsAffected: 0 };
  }),
  getAll: vi.fn(async (sql: string, args: unknown[] = []) => {
    if (sql.includes('FROM line_ai_groups')) { const s = groups.get(String(args[0])); return s ? [{ status: s }] : []; }
    return [];
  }),
}));

import { verifySignature, requestText, handleEvent, isSmallTalk, ACK_TEXT, PENDING_TEXT, NOT_APPROVED_TEXT, THANKS_TEXT } from '@/lib/lineAi';

const g = (id = 'G1') => ({ type: 'group' as const, groupId: id, userId: 'U1' });
const msg = (text: string, mentionees: object[] = [], id = 'e1') => ({
  type: 'message', webhookEventId: id, replyToken: 'r', source: g(),
  message: { type: 'text', text, mention: { mentionees } },
});

describe('lineAi', () => {
  beforeEach(() => { groups.clear(); jobs.length = 0; });

  it('署名を確かめる', () => {
    const body = '{"events":[]}';
    const sig = createHmac('sha256', 'sec').update(body).digest('base64');
    expect(verifySignature(body, sig, 'sec')).toBe(true);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(body, null, 'sec')).toBe(false);
    expect(verifySignature(body, sig, '')).toBe(false);
  });

  it('自分へのメンションだけ依頼にする', () => {
    expect(requestText(msg('@BOOM AI チラシの文を考えて', [{ index: 0, length: 8, isSelf: true }]) as never)).toBe('チラシの文を考えて');
    expect(requestText(msg('@たろう よろしく', [{ index: 0, length: 4 }]) as never)).toBeNull();
    expect(requestText(msg('ふつうの会話') as never)).toBeNull();
  });

  it('招かれたら承認待ち・未承認では受け付けない・承認後は1回だけ積む', async () => {
    const replies: string[] = [];
    const rf = async (_t: string, s: string) => { replies.push(s); };
    expect(await handleEvent({ type: 'join', replyToken: 'r', source: g() }, rf)).toBe('join');
    expect(replies.pop()).toBe(PENDING_TEXT);
    const m = msg('@BOOM AI 文を作って', [{ index: 0, length: 8, isSelf: true }]);
    expect(await handleEvent(m as never, rf)).toBe('reject:未承認');
    expect(replies.pop()).toBe(NOT_APPROVED_TEXT);
    groups.set('G1', 'approved');
    expect(await handleEvent(m as never, rf)).toBe('queued');
    expect(replies.pop()).toBe(ACK_TEXT);
    expect(await handleEvent(m as never, rf)).toBe('dup');
    expect(jobs.length).toBe(1);
  });

  it('承認済みのグループに貼られたファイルだけ記録する', async () => {
    const f = { type: 'message', source: g('G2'), message: { id: 'm9', type: 'image' } };
    expect(await handleEvent(f as never, async () => {})).toBe('skip:未承認のファイル');
    groups.set('G2', 'approved');
    expect(await handleEvent(f as never, async () => {})).toBe('file');
  });

  it('お礼・あいづちには返事だけして作業しない', async () => {
    for (const t of ['OKありがとう', 'ありがとうございます！', '了解です', '👍', '助かる〜', 'お疲れさま']) expect(isSmallTalk(t)).toBe(true);
    for (const t of ['OK、次は12月の時間割を作って', 'ありがとう、ついでに赤にして送り直して', 'チラシを作って']) expect(isSmallTalk(t)).toBe(false);
    groups.set('G1', 'approved');
    const replies: string[] = [];
    const m = msg('@BOOM AI OKありがとう', [{ index: 0, length: 8, isSelf: true }], 'e7');
    expect(await handleEvent(m as never, async (_t, s) => { replies.push(s); })).toBe('thanks');
    expect(replies).toEqual([THANKS_TEXT]);
    expect(jobs.length).toBe(0);
  });

  it('1対1は何もしない', async () => {
    const r = await handleEvent({ type: 'message', source: { type: 'user', userId: 'U' } }, async () => {});
    expect(r).toBe('skip:1対1');
  });
});
