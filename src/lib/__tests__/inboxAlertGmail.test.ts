import { describe, it, expect } from 'vitest';
import { headerMap, extractBodyText, threadResolution, getAccessToken, GmailAuthError, type GmailMessage } from '../inboxAlert/gmail';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

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
});

describe('threadResolution', () => {
  const target: GmailMessage = { id: 'a', threadId: 't', labelIds: ['INBOX'], internalDate: '1000' };
  it('対象より新しい送信済みがあれば返信済み', () => {
    const sent: GmailMessage = { id: 'b', threadId: 't', labelIds: ['SENT'], internalDate: '2000' };
    expect(threadResolution([target, sent], 'a', true)).toBe('replied');
  });
  it('対象より古い送信済みは返信扱いしない', () => {
    const oldSent: GmailMessage = { id: 'b', threadId: 't', labelIds: ['SENT'], internalDate: '500' };
    expect(threadResolution([oldSent, target], 'a', true)).toBeNull();
  });
  it('INBOXラベルが外れていればアーカイブ済み', () => {
    expect(threadResolution([{ ...target, labelIds: [] }], 'a', true)).toBe('archived');
  });
  it('受信時に受信トレイに無かったメールはアーカイブ判定しない', () => {
    expect(threadResolution([{ ...target, labelIds: [] }], 'a', false)).toBeNull();
  });
  it('スレッドが消えていればアーカイブ扱い', () => {
    expect(threadResolution(null, 'a', true)).toBe('archived');
  });
});

describe('getAccessToken', () => {
  const client = { clientId: 'id', clientSecret: 's' };
  it('access_token を返す', async () => {
    const fake = async () => new Response(JSON.stringify({ access_token: 'at' }), { status: 200 });
    await expect(getAccessToken(client, 'rt', fake as typeof fetch)).resolves.toBe('at');
  });
  it('invalid_grant は GmailAuthError にする', async () => {
    const fake = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
    await expect(getAccessToken(client, 'rt', fake as typeof fetch)).rejects.toBeInstanceOf(GmailAuthError);
  });
});
