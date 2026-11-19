import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../instagram', () => ({ getInstagramAuth: async () => ({ token: 'T', igUserId: 'ME' }), GRAPH_BASE: 'https://graph.example' }));
const executed: unknown[][] = [];
vi.mock('../db', () => ({ execute: async (...a: unknown[]) => { executed.push(a); return {}; }, getAll: async () => [], getOne: async () => null }));
vi.mock('../notify', () => ({ notifyTaro: async () => {} }));

import { sendReaction } from '../instagramDm';

describe('sendReaction(絵文字だけのDMにハート・2026-11-19)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('送信APIに sender_action=react と message_id・love を送り、台帳に auto_react で残す', async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal('fetch', async (url: string, init: any) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ recipient_id: 'U1' }) };
    });
    await sendReaction('U1', 'MID1');
    expect(calls[0].url).toBe('https://graph.example/ME/messages');
    expect(calls[0].body).toEqual({ recipient: { id: 'U1' }, sender_action: 'react', payload: { message_id: 'MID1', reaction: 'love' } });
    expect(JSON.stringify(executed.at(-1))).toContain('auto_react');
  });
  it('APIが失敗したら例外(状態は呼び出し側で変えない)', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: false, json: async () => ({ error: { message: 'x' } }) }));
    await expect(sendReaction('U1', 'MID1')).rejects.toThrow('リアクション失敗');
  });
});
