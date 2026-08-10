import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchChannelStats } from '../youtube';

// fetchChannelStats は「トークン取得 → channels.list」の2回 fetch する。
// 順番に返すスタブを立てて、パース(文字列→数値・非公開時のnull)だけを検証する。
function stubFetchSequence(responses: { ok: boolean; status?: number; body: string }[]) {
  let i = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      const r = responses[Math.min(i, responses.length - 1)];
      i++;
      return {
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        text: async () => r.body,
        headers: new Map(),
      } as unknown as Response;
    })
  );
}

const TOKEN_OK = { ok: true, body: JSON.stringify({ access_token: 'dummy-token' }) };

function channelBody(stats: Record<string, unknown>, title = 'BOOM チャンネル') {
  return JSON.stringify({
    items: [{ id: 'UCcHMEFmqpzyGkKew05NmvGA', snippet: { title }, statistics: stats }],
  });
}

describe('fetchChannelStats', () => {
  beforeEach(() => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'id';
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'secret';
    process.env.YOUTUBE_REFRESH_TOKEN = 'refresh';
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.YOUTUBE_REFRESH_TOKEN;
  });

  it('APIが文字列で返す統計値を数値にする', async () => {
    stubFetchSequence([
      TOKEN_OK,
      { ok: true, body: channelBody({ subscriberCount: '256', viewCount: '48210', videoCount: '100' }) },
    ]);
    const st = await fetchChannelStats();
    expect(st).not.toBeNull();
    expect(st!.subscribers).toBe(256);
    expect(st!.views).toBe(48210);
    expect(st!.videos).toBe(100);
    expect(st!.channelId).toBe('UCcHMEFmqpzyGkKew05NmvGA');
    expect(st!.title).toBe('BOOM チャンネル');
  });

  it('登録者数が非公開のチャンネルは0ではなくnullにする', async () => {
    // 0 と「取れなかった」を取り違えると、グラフ上は登録者が消えたように見えてしまう
    stubFetchSequence([
      TOKEN_OK,
      { ok: true, body: channelBody({ subscriberCount: '0', hiddenSubscriberCount: true, viewCount: '10' }) },
    ]);
    const st = await fetchChannelStats();
    expect(st!.subscribers).toBeNull();
    expect(st!.views).toBe(10);
  });

  it('統計値が欠けていてもnullで返す(0にしない)', async () => {
    stubFetchSequence([TOKEN_OK, { ok: true, body: channelBody({}) }]);
    const st = await fetchChannelStats();
    expect(st!.subscribers).toBeNull();
    expect(st!.views).toBeNull();
    expect(st!.videos).toBeNull();
  });

  it('itemsが空ならnull(呼び出し側でエラー扱いにできる)', async () => {
    stubFetchSequence([TOKEN_OK, { ok: true, body: JSON.stringify({ items: [] }) }]);
    expect(await fetchChannelStats()).toBeNull();
  });

  it('APIがエラーを返したらthrowする(黙って欠測にしない)', async () => {
    stubFetchSequence([TOKEN_OK, { ok: false, status: 403, body: '{"error":"quotaExceeded"}' }]);
    await expect(fetchChannelStats()).rejects.toThrow(/403/);
  });

  it('env未設定ならAPIを叩かずnullを返す', async () => {
    delete process.env.YOUTUBE_REFRESH_TOKEN;
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    expect(await fetchChannelStats()).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
