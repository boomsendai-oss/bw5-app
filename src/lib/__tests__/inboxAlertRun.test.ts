import { describe, it, expect } from 'vitest';
import { runAccount, STALL_THRESHOLD, type GmailPort, type RunDeps } from '../inboxAlert/run';
import { GmailApiError, GmailAuthError, GmailNotFoundError, type GmailMessage } from '../inboxAlert/gmail';
import type { AlertStore, AlertState, NewItem, OpenItem } from '../inboxAlert/store';
import type { ClassifyResult } from '../inboxAlert/classify';
import type { PushoverMessage } from '../inboxAlert/pushover';
import type { AlertAccount } from '../inboxAlert/accounts';

// JST 2026-09-11 12:00
const NOW = Date.UTC(2026, 8, 11, 3, 0);
const OVERLAP_SEC = 60 * 60;
const STALL_TITLE = '【受信箱アラート】BOOMの監視が止まっています';
const account: AlertAccount = { key: 'boom', label: 'BOOM', refreshToken: 'rt', pushoverToken: 'po' };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

type StoredItem = NewItem & { notifiedAt: string | null; resolved: string | null };

function memoryStore(initial: Partial<AlertState> = {}) {
  const state: AlertState = {
    lastCheckedMs: 0, lastSuccessAt: '', consecutiveErrors: 0, tokenAlertDate: '', stallAlerted: false, ...initial,
  };
  const items = new Map<string, StoredItem>();
  const toOpen = (i: StoredItem): OpenItem => ({
    account: i.account, messageId: i.messageId, threadId: i.threadId, receivedMs: i.receivedMs,
    kind: i.kind, aiFailed: i.aiFailed, inInbox: i.inInbox,
  });
  const store: AlertStore = {
    getState: async () => ({ ...state }),
    saveSuccess: async (_a, last, nowIso) => { state.lastCheckedMs = last; state.lastSuccessAt = nowIso; state.consecutiveErrors = 0; },
    saveError: async () => ++state.consecutiveErrors,
    setTokenAlertDate: async (_a, date) => { state.tokenAlertDate = date; },
    setStallAlerted: async (_a, on) => { state.stallAlerted = on; },
    knownIds: async (_a, ids) => new Set(ids.filter((id) => items.has(id))),
    insertItem: async (item, nowIso) => {
      if (!items.has(item.messageId)) items.set(item.messageId, { ...item, notifiedAt: item.notified ? nowIso : null, resolved: null });
    },
    listUnnotified: async () => [...items.values()].filter((i) => i.tier === 'now' && !i.notifiedAt && !i.resolved && !i.dryRun).map(toOpen),
    markNotified: async (_a, id, nowIso) => { items.get(id)!.notifiedAt = nowIso; },
    listOpen: async () => [...items.values()].filter((i) => i.tier === 'now' && !i.resolved && !i.dryRun).map(toOpen),
    markResolved: async (_a, id, reason) => { items.get(id)!.resolved = reason; },
  };
  return { store, state, items };
}

function msg(id: string, opts: { labels?: string[]; subject?: string; headers?: Record<string, string> } = {}): GmailMessage {
  return {
    id,
    threadId: `t-${id}`,
    labelIds: opts.labels ?? ['INBOX'],
    internalDate: String(NOW - 60_000),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: '"山田" <p@gmail.com>' },
        { name: 'Subject', value: opts.subject ?? `件名${id}` },
        ...Object.entries(opts.headers ?? {}).map(([name, value]) => ({ name, value })),
      ],
      body: { data: b64('本文') },
    },
  };
}

/** messages は古い順で渡す。一覧APIは本物と同じく新しい順で返す */
function fakeGmail(messages: GmailMessage[], overrides: Partial<GmailPort> = {}) {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const listedAfter: number[] = [];
  const gmail: GmailPort = {
    accessToken: async () => 'at',
    profileEmail: async () => 'boom.sendai@gmail.com',
    listSince: async (_t, afterSec) => {
      listedAfter.push(afterSec);
      return [...messages].reverse().map((m) => ({ id: m.id, threadId: m.threadId }));
    },
    meta: async (_t, id) => byId.get(id)!,
    full: async (_t, id) => byId.get(id)!,
    thread: async (_t, threadId) => messages.filter((m) => m.threadId === threadId),
    ...overrides,
  };
  return { gmail, listedAfter };
}

function makeDeps(over: Partial<RunDeps> & { gmail: GmailPort; store: AlertStore }) {
  const pushed: PushoverMessage[] = [];
  const classified: string[] = [];
  const deps: RunDeps = {
    classify: async (mail, mode): Promise<ClassifyResult> => {
      classified.push(`${mail.subject}:${mode}`);
      return { tier: 'now', kind: 'new_inquiry', summary: '体験の相談', aiFailed: false, inputTokens: 10, outputTokens: 2 };
    },
    push: async (_token, m) => { pushed.push(m); },
    nowMs: () => NOW,
    deadlineMs: NOW + 45_000,
    dryRun: false,
    backfillDays: 0,
    ...over,
  };
  return { deps, pushed, classified };
}

const storedNow = (id: string, receivedMs: number): NewItem => ({
  account: 'boom', messageId: id, threadId: `t-${id}`, receivedMs, readMode: 'ai_full', tier: 'now', kind: 'new_inquiry',
  aiFailed: false, inInbox: true, dryRun: false, inputTokens: 0, outputTokens: 0, notified: true,
});

describe('runAccount', () => {
  it('初回(過去分の判定なし)は既読扱いで記録するだけで、AI判定も通知もしない', async () => {
    const { store, state, items } = memoryStore();
    const { gmail, listedAfter } = fakeGmail([msg('a'), msg('b')]);
    const { deps, pushed, classified } = makeDeps({ gmail, store });
    const r = await runAccount(account, deps);
    expect(r).toMatchObject({ fresh: 2, processed: 2, notified: 0, complete: true });
    expect(classified).toEqual([]);
    expect(pushed).toEqual([]);
    expect([...items.values()].map((i) => i.readMode)).toEqual(['baseline', 'baseline']);
    expect(state.lastCheckedMs).toBe(NOW);
    expect(listedAfter).toEqual([Math.floor(NOW / 1000) - OVERLAP_SEC]);
  });

  it('2回目以降: 宣伝は件数だけ、人のメールはAI判定して鳴らす。記録済みは飛ばす', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    await store.insertItem({ ...storedNow('old', 0), tier: 'count', notified: false }, 'x');
    const { gmail, listedAfter } = fakeGmail([
      msg('old'),
      msg('promo', { labels: ['INBOX', 'CATEGORY_PROMOTIONS'], headers: { 'List-Unsubscribe': '<mailto:u@shop.jp>' } }),
      msg('human', { subject: '体験レッスンの相談' }),
    ]);
    const { deps, pushed, classified } = makeDeps({ gmail, store });
    const r = await runAccount(account, deps);
    expect(r).toMatchObject({ fresh: 2, processed: 2, notified: 1, inputTokens: 10, complete: true });
    expect(classified).toEqual(['体験レッスンの相談:ai_full']);
    expect(pushed).toHaveLength(1);
    expect(pushed[0].title).toBe('【新規の問い合わせ】体験レッスンの相談');
    expect(pushed[0].url).toBe('https://mail.google.com/mail/u/?authuser=boom.sendai%40gmail.com#all/t-human');
    expect(items.get('promo')!.tier).toBe('count');
    expect(items.get('human')!.notifiedAt).not.toBeNull();
    expect(listedAfter).toEqual([Math.floor((NOW - 300_000) / 1000) - OVERLAP_SEC]);
  });

  it('ドライランでは通知を送らず、ドライランの印をつけて記録する', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const { gmail } = fakeGmail([msg('human')]);
    const { deps, pushed } = makeDeps({ gmail, store, dryRun: true });
    const r = await runAccount(account, deps);
    expect(r.notified).toBe(0);
    expect(pushed).toEqual([]);
    expect(items.get('human')).toMatchObject({ tier: 'now', dryRun: true, notifiedAt: null });
  });

  it('過去分の判定は時間切れなら途中で止め、次回に続きから判定する', async () => {
    const { store, state, items } = memoryStore();
    let clock = NOW;
    const { gmail, listedAfter } = fakeGmail([msg('a'), msg('b'), msg('c')]);
    const slowClassify: RunDeps['classify'] = async () => {
      clock += 600;
      return { tier: 'count', kind: 'other', summary: '', aiFailed: false, inputTokens: 1, outputTokens: 1 };
    };
    const first = makeDeps({ gmail, store, dryRun: true, backfillDays: 30, nowMs: () => clock, deadlineMs: NOW + 1000, classify: slowClassify });
    const r1 = await runAccount(account, first.deps);
    expect(r1).toMatchObject({ processed: 2, complete: false });
    expect(state.lastCheckedMs).toBe(0);
    expect(listedAfter[0]).toBe(Math.floor(NOW / 1000) - 30 * 86_400);

    const second = makeDeps({ gmail, store, dryRun: true, backfillDays: 30, nowMs: () => NOW + 300_000, deadlineMs: NOW + 345_000, classify: slowClassify });
    const r2 = await runAccount(account, second.deps);
    expect(r2).toMatchObject({ fresh: 1, processed: 1, complete: true });
    expect(items.size).toBe(3);
    expect(state.lastCheckedMs).toBe(NOW + 300_000);
  });

  it('通知ありの時は、過去分の判定日数が渡されても過去分を判定しない', async () => {
    const { store, items } = memoryStore();
    const { gmail, listedAfter } = fakeGmail([msg('old')]);
    const { deps, classified } = makeDeps({ gmail, store, backfillDays: 30 });
    await runAccount(account, deps);
    expect(listedAfter).toEqual([Math.floor(NOW / 1000) - OVERLAP_SEC]);
    expect(classified).toEqual([]);
    expect(items.get('old')!.readMode).toBe('baseline');
  });

  it('朝のまとめ行きの判定は鳴らさない', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const { gmail } = fakeGmail([msg('notice')]);
    const { deps, pushed } = makeDeps({
      gmail,
      store,
      classify: async () => ({ tier: 'digest', kind: 'automation_failure', summary: '', aiFailed: false, inputTokens: 1, outputTokens: 1 }),
    });
    await runAccount(account, deps);
    expect(pushed).toEqual([]);
    expect(items.get('notice')!.tier).toBe('digest');
  });

  it('返信済みの未対応を閉じる', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    await store.insertItem(storedNow('q', NOW - 3_600_000), 'x');
    const question: GmailMessage = { ...msg('q'), internalDate: String(NOW - 3_600_000) };
    const answer: GmailMessage = { id: 'r', threadId: 't-q', labelIds: ['SENT'], internalDate: String(NOW - 60_000) };
    const { gmail } = fakeGmail([], { thread: async () => [question, answer] });
    const { deps } = makeDeps({ gmail, store });
    const r = await runAccount(account, deps);
    expect(r.resolved).toBe(1);
    expect(items.get('q')!.resolved).toBe('replied');
  });

  it('受信トレイを通らなかったメールは、INBOXラベルが無くてもアーカイブ扱いで閉じない', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    await store.insertItem({ ...storedNow('filtered', NOW - 60_000), inInbox: false }, 'x');
    const { gmail } = fakeGmail([], {
      thread: async () => [{ id: 'filtered', threadId: 't-filtered', labelIds: ['Label_1'], internalDate: String(NOW - 60_000) }],
    });
    const { deps } = makeDeps({ gmail, store });
    await runAccount(account, deps);
    expect(items.get('filtered')!.resolved).toBeNull();
  });

  it('通知の送信に失敗したら、次の回に再送する', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const { gmail } = fakeGmail([msg('human')]);
    let failing = true;
    const pushed: PushoverMessage[] = [];
    const { deps } = makeDeps({
      gmail,
      store,
      push: async (_t, m) => {
        if (failing) throw new Error('pushover 500');
        pushed.push(m);
      },
    });
    const r1 = await runAccount(account, deps);
    expect(r1).toMatchObject({ notified: 0, pushFailed: 2 });
    expect(items.get('human')!.notifiedAt).toBeNull();

    failing = false;
    const r2 = await runAccount(account, deps);
    expect(r2.notified).toBe(1);
    expect(pushed).toHaveLength(1);
    expect(items.get('human')!.notifiedAt).not.toBeNull();
  });

  it('通知を送れないまま削除されたメールは、再送せずに未対応から外す', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    await store.insertItem({ ...storedNow('lost', NOW - 60_000), notified: false }, 'x');
    const { gmail } = fakeGmail([], {
      meta: async () => {
        throw new GmailNotFoundError('gmail 404 /messages/lost');
      },
      thread: async () => [{ id: 'lost', threadId: 't-lost', labelIds: ['INBOX'], internalDate: String(NOW - 60_000) }],
    });
    const { deps, pushed } = makeDeps({ gmail, store });
    await runAccount(account, deps);
    expect(pushed).toEqual([]);
    expect(items.get('lost')!.resolved).toBe('archived');
  });

  it('一覧を取った後に消えたメールは飛ばして、残りを処理する', async () => {
    const { store, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const base = fakeGmail([msg('gone'), msg('human')]);
    const gmail: GmailPort = {
      ...base.gmail,
      meta: async (t, id) => {
        if (id === 'gone') throw new GmailNotFoundError('gmail 404 /messages/gone');
        return base.gmail.meta(t, id);
      },
    };
    const { deps } = makeDeps({ gmail, store });
    const r = await runAccount(account, deps);
    expect(r).toMatchObject({ fresh: 2, processed: 1, complete: true });
    expect(items.has('gone')).toBe(false);
    expect(items.has('human')).toBe(true);
  });

  it('1通だけGmail側で失敗し続けても新しいメールは通知し、前回確認時刻は進めない', async () => {
    const { store, state, items } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const base = fakeGmail([msg('poison'), msg('human', { subject: '体験レッスンの相談' })]);
    const gmail: GmailPort = {
      ...base.gmail,
      full: async (t, id) => {
        if (id === 'poison') throw new GmailApiError('gmail 500 /messages/poison');
        return base.gmail.full(t, id);
      },
    };
    const { deps, pushed } = makeDeps({ gmail, store });
    const r = await runAccount(account, deps);
    expect(pushed.map((m) => m.title)).toEqual(['【新規の問い合わせ】体験レッスンの相談']);
    expect(items.has('poison')).toBe(false);
    expect(r).toMatchObject({ complete: false, error: 'gmail 500 /messages/poison' });
    expect(state.lastCheckedMs).toBe(NOW - 300_000);
    expect(state.consecutiveErrors).toBe(1);
  });

  it('締め切りを過ぎてから呼ばれたら、何も触らず次回に回す', async () => {
    const { store, state } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const calls: string[] = [];
    const { gmail } = fakeGmail([], {
      accessToken: async () => {
        calls.push('token');
        return 'at';
      },
    });
    const { deps } = makeDeps({ gmail, store, deadlineMs: NOW - 1 });
    const r = await runAccount(account, deps);
    expect(r).toMatchObject({ complete: false, error: 'skipped: deadline' });
    expect(calls).toEqual([]);
    expect(state.lastCheckedMs).toBe(NOW - 300_000);
  });

  it('DBまで落ちていても例外を外に投げない(他のアカウントの処理を止めない)', async () => {
    const { store } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const broken: AlertStore = {
      ...store,
      knownIds: async () => {
        throw new Error('db down');
      },
      saveError: async () => {
        throw new Error('db down');
      },
    };
    const { gmail } = fakeGmail([msg('human')]);
    const { deps } = makeDeps({ gmail, store: broken });
    const r = await runAccount(account, deps);
    expect(r.error).toBe('db down / store: db down');
  });

  it('Gmailの連携が切れたら、その日1回だけ知らせる', async () => {
    const { store, state } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const { gmail } = fakeGmail([], { accessToken: async () => { throw new GmailAuthError('invalid_grant'); } });
    const { deps, pushed } = makeDeps({ gmail, store });
    const r = await runAccount(account, deps);
    expect(r.error).toBe('invalid_grant');
    await runAccount(account, deps);
    expect(pushed.map((m) => m.title)).toEqual(['【受信箱アラート】BOOMのGmail連携が切れました']);
    expect(state.tokenAlertDate).toBe('2026-09-11');
  });

  it('連続で失敗したら、止まっていることを1回だけ知らせる', async () => {
    const { store, state } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const { gmail } = fakeGmail([], { listSince: async () => { throw new Error('gmail 500 /messages'); } });
    const { deps, pushed } = makeDeps({ gmail, store });
    for (let i = 0; i < STALL_THRESHOLD + 2; i++) await runAccount(account, deps);
    expect(pushed.map((m) => m.title)).toEqual([STALL_TITLE]);
    expect(state.stallAlerted).toBe(true);
  });

  it('ドライラン中に積もったエラーは、本番に切り替えた後の警報を黙らせない', async () => {
    const { store, state } = memoryStore({ lastCheckedMs: NOW - 300_000 });
    const { gmail } = fakeGmail([], { listSince: async () => { throw new Error('gmail 500 /messages'); } });
    const dry = makeDeps({ gmail, store, dryRun: true });
    for (let i = 0; i < STALL_THRESHOLD; i++) await runAccount(account, dry.deps);
    expect(state.stallAlerted).toBe(false);
    const live = makeDeps({ gmail, store });
    await runAccount(account, live.deps);
    expect(live.pushed.map((m) => m.title)).toEqual([STALL_TITLE]);
  });

  it('最後の成功から30分以上たっていたら知らせる。送れなかった時は印をつけず、次の回にまた送る', async () => {
    const { store, state } = memoryStore({
      lastCheckedMs: NOW - 3_600_000,
      lastSuccessAt: new Date(NOW - 40 * 60_000).toISOString(),
    });
    const { gmail } = fakeGmail([], { listSince: async () => { throw new Error('gmail hung'); } });
    let failing = true;
    const titles: string[] = [];
    const { deps } = makeDeps({
      gmail,
      store,
      push: async (_t, m) => {
        if (failing) throw new Error('pushover down');
        titles.push(m.title);
      },
    });
    await runAccount(account, deps);
    expect(state.stallAlerted).toBe(false);
    failing = false;
    await runAccount(account, deps);
    expect(titles).toEqual([STALL_TITLE]);
    expect(state.stallAlerted).toBe(true);
    await runAccount(account, deps);
    expect(titles).toHaveLength(1);
  });

  it('成功したら、止まっている印と連携切れの日付を戻す', async () => {
    const { store, state } = memoryStore({ lastCheckedMs: NOW - 300_000, stallAlerted: true, tokenAlertDate: '2026-09-11' });
    const { gmail } = fakeGmail([]);
    const { deps } = makeDeps({ gmail, store });
    await runAccount(account, deps);
    expect(state).toMatchObject({ stallAlerted: false, tokenAlertDate: '' });
  });
});
