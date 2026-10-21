import { describe, it, expect, beforeEach, vi } from 'vitest';
import { formatSubject, notifyTaro, pushoverTarget } from '../notify';

describe('formatSubject', () => {
  it('prefix未指定なら既存の [BOOM Story] を保つ(既存呼び出し側の互換)', () => {
    expect(formatSubject('要対応 2026-07-20')).toBe('[BOOM Story] 要対応 2026-07-20');
  });

  it('prefixを指定したらそれを使う', () => {
    expect(formatSubject('同期が失敗しました', '[BOOM 同期]')).toBe(
      '[BOOM 同期] 同期が失敗しました'
    );
  });

  it('prefixに空文字を渡したら既定値にフォールバックする', () => {
    expect(formatSubject('件名', '')).toBe('[BOOM Story] 件名');
  });
});

// ── notifyTaro の経路順(2026-10-16: Gmailのアプリパスワード失効で障害通知が届かなかった再発防止)

type Call = { url: string; body: unknown };

function fakeFetch(handlers: { pushover?: () => Response; line?: () => Response }) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body });
    if (url.includes('pushover')) {
      return handlers.pushover ? handlers.pushover() : new Response(JSON.stringify({ status: 1 }), { status: 200 });
    }
    if (url.includes('line.me')) {
      return handlers.line ? handlers.line() : new Response('{}', { status: 200 });
    }
    throw new Error(`unexpected ${url}`);
  }) as typeof fetch;
  return { calls, impl };
}

const PO_ENV = { PUSHOVER_USER_KEY: 'u', PUSHOVER_TOKEN_BOOM: 'tb', PUSHOVER_TOKEN_TARO: 'tt' };
const LINE_ENV = { LINE_CHANNEL_ACCESS_TOKEN: 'lt', TARO_LINE_USER_ID: 'lu' };
const poFail = () => new Response(JSON.stringify({ status: 0, errors: ['application token is invalid'], token: 'invalid' }), { status: 400 });

describe('pushoverTarget', () => {
  it('BOOM → TARO → NITROASH の順で鍵を選ぶ', () => {
    expect(pushoverTarget({ PUSHOVER_USER_KEY: 'u', PUSHOVER_TOKEN_BOOM: 'b', PUSHOVER_TOKEN_TARO: 't' })).toEqual({ userKey: 'u', appToken: 'b' });
    expect(pushoverTarget({ PUSHOVER_USER_KEY: 'u', PUSHOVER_TOKEN_TARO: 't', PUSHOVER_TOKEN_NITROASH: 'n' })).toEqual({ userKey: 'u', appToken: 't' });
    expect(pushoverTarget({ PUSHOVER_USER_KEY: 'u', PUSHOVER_TOKEN_NITROASH: 'n' })).toEqual({ userKey: 'u', appToken: 'n' });
  });
  it('ユーザーキーか鍵が欠けていれば null', () => {
    expect(pushoverTarget({ PUSHOVER_TOKEN_BOOM: 'b' })).toBeNull();
    expect(pushoverTarget({ PUSHOVER_USER_KEY: 'u' })).toBeNull();
  });
});

describe('notifyTaro', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('Pushoverが成功したら、メールも控えとして送る(LINEは使わない)', async () => {
    const { calls, impl } = fakeFetch({});
    const sendMail = vi.fn(async () => {});
    await notifyTaro({ subject: '件名', body: '本文' }, { env: { ...PO_ENV, ...LINE_ENV }, fetchImpl: impl, sendMail });
    expect(calls.map((c) => c.url)).toEqual(['https://api.pushover.net/1/messages.json']);
    const body = calls[0].body as URLSearchParams;
    expect(body.get('token')).toBe('tb');
    expect(body.get('user')).toBe('u');
    expect(body.get('title')).toBe('[BOOM Story] 件名');
    expect(body.get('message')).toBe('本文');
    expect(sendMail).toHaveBeenCalledWith('[BOOM Story] 件名', '本文');
  });

  it('Pushoverが成功していれば、メールが失敗しても throw しない', async () => {
    const { impl } = fakeFetch({});
    const sendMail = vi.fn(async () => { throw new Error('535 Invalid login'); });
    await expect(notifyTaro({ subject: 's', body: 'b' }, { env: PO_ENV, fetchImpl: impl, sendMail })).resolves.toBeUndefined();
  });

  it('Pushoverの上限(タイトル250・本文1024文字)に切り詰める', async () => {
    const { calls, impl } = fakeFetch({});
    await notifyTaro(
      { subject: 'あ'.repeat(400), body: 'い'.repeat(3000) },
      { env: PO_ENV, fetchImpl: impl, sendMail: async () => {} },
    );
    const body = calls[0].body as URLSearchParams;
    expect(Array.from(body.get('title')!).length).toBe(250);
    expect(Array.from(body.get('message')!).length).toBe(1024);
    expect(body.get('message')!.endsWith('…')).toBe(true);
  });

  it('Pushoverが失敗したらLINEへ。LINEが通ればメールは送らない', async () => {
    const { calls, impl } = fakeFetch({ pushover: poFail });
    const sendMail = vi.fn(async () => {});
    await notifyTaro({ subject: 's', body: 'b' }, { env: { ...PO_ENV, ...LINE_ENV }, fetchImpl: impl, sendMail });
    expect(calls.map((c) => c.url)).toEqual(['https://api.pushover.net/1/messages.json', 'https://api.line.me/v2/bot/message/push']);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('Pushover未設定・LINE未設定ならメールだけ(従来どおり)', async () => {
    const { calls, impl } = fakeFetch({});
    const sendMail = vi.fn(async () => {});
    await notifyTaro({ subject: 's', body: 'b', subjectPrefix: '[BOOM 同期]' }, { env: {}, fetchImpl: impl, sendMail });
    expect(calls).toHaveLength(0);
    expect(sendMail).toHaveBeenCalledWith('[BOOM 同期] s', 'b');
  });

  it('Pushover失敗・LINE失敗でもメールが通れば throw しない', async () => {
    const { impl } = fakeFetch({ pushover: poFail, line: () => new Response('bad', { status: 401 }) });
    const sendMail = vi.fn(async () => {});
    await expect(
      notifyTaro({ subject: 's', body: 'b' }, { env: { ...PO_ENV, ...LINE_ENV }, fetchImpl: impl, sendMail }),
    ).resolves.toBeUndefined();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('全経路が失敗したら、それぞれの理由をまとめて throw する', async () => {
    const { impl } = fakeFetch({ pushover: poFail, line: () => new Response('bad', { status: 401 }) });
    const sendMail = vi.fn(async () => { throw new Error('535 Invalid login'); });
    await expect(
      notifyTaro({ subject: 's', body: 'b' }, { env: { ...PO_ENV, ...LINE_ENV }, fetchImpl: impl, sendMail }),
    ).rejects.toThrow(/Pushover: pushover 400.*LINE: LINE push 401.*メール: 535 Invalid login/);
  });

  it('Pushoverの通信エラー(fetchが例外)でも次の経路へ進む', async () => {
    const impl = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    const sendMail = vi.fn(async () => {});
    await notifyTaro({ subject: 's', body: 'b' }, { env: PO_ENV, fetchImpl: impl, sendMail });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});
