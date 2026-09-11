import { describe, it, expect } from 'vitest';
import {
  headerMap,
  extractBodyText,
  threadResolution,
  getAccessToken,
  getProfileEmail,
  getMessageMeta,
  getThreadMessages,
  listMessageRefsSince,
  GmailAuthError,
  GmailNotFoundError,
  GmailApiError,
  type GmailMessage,
} from '../inboxAlert/gmail';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const status = (code: number, body: unknown = {}) =>
  (async () => new Response(JSON.stringify(body), { status: code })) as typeof fetch;

describe('headerMap', () => {
  it('ヘッダー名を小文字にする', () => {
    expect(headerMap({ headers: [{ name: 'Subject', value: '件名' }, { name: 'List-Unsubscribe', value: '<x>' }] }))
      .toEqual({ subject: '件名', 'list-unsubscribe': '<x>' });
  });
});

describe('extractBodyText', () => {
  it('text/plain を優先してデコードし、空白を詰める', () => {
    const msg: GmailMessage = {
      id: 'm', threadId: 't', snippet: 'スニペット',
      payload: { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/html', body: { data: b64('<p>HTML</p>') } },
        { mimeType: 'text/plain', body: { data: b64('体験レッスンの\n\n相談です') } },
      ] },
    };
    expect(extractBodyText(msg)).toBe('体験レッスンの 相談です');
  });
  it('text/plain が無ければHTMLのタグとstyleを外す', () => {
    const msg: GmailMessage = {
      id: 'm', threadId: 't',
      payload: { mimeType: 'text/html', body: { data: b64('<style>p{}</style><p>見積&amp;納期</p>') } },
    };
    expect(extractBodyText(msg)).toBe('見積&納期');
  });
  it('文字化けが多ければスニペットを使う', () => {
    const msg: GmailMessage = {
      id: 'm', threadId: 't', snippet: '読めるスニペット',
      payload: { mimeType: 'text/plain', body: { data: b64('���ab') } },
    };
    expect(extractBodyText(msg)).toBe('読めるスニペット');
  });
  it('入れ子のmultipartと末尾=付きのbase64を読み、添付のテキストは本文にしない', () => {
    const padded = Buffer.from('ok見積', 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
    expect(padded.endsWith('=')).toBe(true);
    const msg: GmailMessage = {
      id: 'm', threadId: 't',
      payload: { mimeType: 'multipart/mixed', parts: [
        { mimeType: 'text/plain', filename: 'memo.txt', body: { data: b64('添付のメモ') } },
        { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: padded } }] },
      ] },
    };
    expect(extractBodyText(msg)).toBe('ok見積');
  });
  it('本文が空ならスニペットを使う', () => {
    const msg: GmailMessage = {
      id: 'm', threadId: 't', snippet: 'スニペット',
      payload: { mimeType: 'text/plain', body: { data: b64('   ') } },
    };
    expect(extractBodyText(msg)).toBe('スニペット');
  });
});

describe('threadResolution', () => {
  const target: GmailMessage = { id: 'a', threadId: 't', labelIds: ['INBOX'], internalDate: '1000' };
  const sent: GmailMessage = { id: 'b', threadId: 't', labelIds: ['SENT'], internalDate: '2000' };
  /** 受信時に受信トレイにあり、通知も届いた */
  const inbox = { inInbox: true, notified: true };
  /** 受信時に受信トレイに無く、通知は届いた */
  const outside = { inInbox: false, notified: true };
  it('対象より新しい送信済みがあれば返信済み', () => {
    expect(threadResolution([target, sent], 'a', inbox)).toBe('replied');
  });
  it('対象より古い送信済みは返信扱いしない', () => {
    const oldSent: GmailMessage = { id: 'b', threadId: 't', labelIds: ['SENT'], internalDate: '500' };
    expect(threadResolution([oldSent, target], 'a', inbox)).toBeNull();
  });
  it('返信済みはゴミ箱より先に判定する', () => {
    expect(threadResolution([{ ...target, labelIds: ['TRASH'] }, sent], 'a', inbox)).toBe('replied');
  });
  it('INBOXラベルが外れていればアーカイブ済み', () => {
    expect(threadResolution([{ ...target, labelIds: [] }], 'a', inbox)).toBe('archived');
  });
  it('受信時に受信トレイに無かったメールはアーカイブ判定しない', () => {
    expect(threadResolution([{ ...target, labelIds: ['UNREAD'] }], 'a', outside)).toBeNull();
  });
  it('受信トレイを通らなかったメールは、読んだら閉じる', () => {
    expect(threadResolution([{ ...target, labelIds: [] }], 'a', outside)).toBe('archived');
  });
  it('ゴミ箱に入れたら閉じる', () => {
    expect(threadResolution([{ ...target, labelIds: ['TRASH', 'INBOX'] }], 'a', inbox)).toBe('archived');
    expect(threadResolution([{ ...target, labelIds: ['TRASH', 'UNREAD'] }], 'a', outside)).toBe('archived');
  });
  it('迷惑メールにしたら閉じる', () => {
    expect(threadResolution([{ ...target, labelIds: ['SPAM', 'INBOX'] }], 'a', inbox)).toBe('archived');
    expect(threadResolution([{ ...target, labelIds: ['SPAM', 'UNREAD'] }], 'a', outside)).toBe('archived');
  });
  it('通知が届いていないメールは、アーカイブ・既読では閉じない(閉じると再送されなくなるため)', () => {
    expect(threadResolution([{ ...target, labelIds: [] }], 'a', { inInbox: true, notified: false })).toBeNull();
    expect(threadResolution([{ ...target, labelIds: [] }], 'a', { inInbox: false, notified: false })).toBeNull();
  });
  it('通知が届いていないメールでも、返信・ゴミ箱・迷惑メール・削除では閉じる', () => {
    const unsent = { inInbox: false, notified: false };
    expect(threadResolution([{ ...target, labelIds: [] }, sent], 'a', unsent)).toBe('replied');
    expect(threadResolution([{ ...target, labelIds: ['TRASH'] }], 'a', unsent)).toBe('archived');
    expect(threadResolution([{ ...target, labelIds: ['SPAM'] }], 'a', unsent)).toBe('archived');
    expect(threadResolution(null, 'a', unsent)).toBe('archived');
    expect(threadResolution([sent], 'a', unsent)).toBe('archived');
  });
  it('スレッドが消えていればアーカイブ扱い', () => {
    expect(threadResolution(null, 'a', inbox)).toBe('archived');
  });
  it('対象のメールがスレッドに無ければアーカイブ扱い', () => {
    expect(threadResolution([{ id: 'z', threadId: 't', labelIds: ['INBOX'], internalDate: '1' }], 'a', inbox)).toBe('archived');
  });
});

describe('getAccessToken', () => {
  const client = { clientId: 'id', clientSecret: 's' };
  it('access_token を返す', async () => {
    await expect(getAccessToken(client, 'rt', status(200, { access_token: 'at' }))).resolves.toBe('at');
  });
  it('invalid_grant は GmailAuthError にする', async () => {
    await expect(getAccessToken(client, 'rt', status(400, { error: 'invalid_grant' }))).rejects.toBeInstanceOf(GmailAuthError);
  });
  it('invalid_grant 以外の失敗は通常のエラー', async () => {
    const err = await getAccessToken(client, 'rt', status(400, { error: 'invalid_client' })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GmailAuthError);
    expect((err as Error).message).toBe('token 400 invalid_client');
  });
});

describe('Gmail API ラッパー', () => {
  it('一覧は次のページが無くなるまで取り、検索条件とページトークンをURLに入れる', async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      const body = urls.length === 1
        ? { messages: [{ id: 'a', threadId: 'ta' }], nextPageToken: '123' }
        : { messages: [{ id: 'b', threadId: 'tb' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const refs = await listMessageRefsSince('tok', 1_700_000_000, fake);
    expect(refs.map((r) => r.id)).toEqual(['a', 'b']);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(`q=${encodeURIComponent('after:1700000000 -in:sent -in:chats')}`);
    expect(urls[1]).toContain('&pageToken=123');
  });
  it('スレッドが見つからなければ null、それ以外のエラーは例外', async () => {
    await expect(getThreadMessages('tok', 't', status(404))).resolves.toBeNull();
    await expect(getThreadMessages('tok', 't', status(500))).rejects.toThrow('gmail 500');
    await expect(getThreadMessages('tok', 't', status(500))).rejects.toBeInstanceOf(GmailApiError);
  });
  it('メールが見つからなければ GmailNotFoundError、401 は GmailAuthError', async () => {
    await expect(getMessageMeta('tok', 'm', status(404))).rejects.toBeInstanceOf(GmailNotFoundError);
    await expect(getProfileEmail('tok', status(401))).rejects.toBeInstanceOf(GmailAuthError);
  });
});
