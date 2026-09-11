import { describe, it, expect } from 'vitest';
import { displaySender, gmailLink, buildNowMessage, sendPushover } from '../inboxAlert/pushover';
import { charLength } from '../inboxAlert/format';

const base = {
  subject: '体験レッスンの相談',
  from: '"山田" <p@gmail.com>',
  summary: '体験の相談',
  kind: 'new_inquiry' as const,
  aiFailed: false,
  link: 'https://mail.google.com/x',
};

describe('displaySender', () => {
  it('表示名があれば表示名、無ければアドレス', () => {
    expect(displaySender('"山田" <p@gmail.com>')).toBe('山田');
    expect(displaySender('<p@gmail.com>')).toBe('p@gmail.com');
    expect(displaySender('p@gmail.com')).toBe('p@gmail.com');
  });
});

describe('gmailLink', () => {
  it('アカウントを指定してスレッドを開くURL', () => {
    expect(gmailLink('boom.sendai@gmail.com', 'abc')).toBe('https://mail.google.com/mail/u/?authuser=boom.sendai%40gmail.com#all/abc');
  });
});

describe('buildNowMessage', () => {
  it('種類の見出し＋件名をタイトルに、差出人と要約を本文にする', () => {
    expect(buildNowMessage(base)).toEqual({
      title: '【新規の問い合わせ】体験レッスンの相談',
      message: '差出人: 山田\n要約: 体験の相談',
      url: 'https://mail.google.com/x',
      url_title: 'Gmailで開く',
    });
  });
  it('AI判定できなかった時はそれが分かる見出しにし、要約行を出さない', () => {
    const m = buildNowMessage({ ...base, aiFailed: true, summary: '' });
    expect(m.title).toBe('【AI判定できず】体験レッスンの相談');
    expect(m.message).toBe('差出人: 山田');
  });
  it('件名が空なら (件名なし)', () => {
    expect(buildNowMessage({ ...base, subject: '' }).title).toBe('【新規の問い合わせ】(件名なし)');
  });
  it('タイトルは250字に収める', () => {
    expect(charLength(buildNowMessage({ ...base, subject: 'あ'.repeat(400) }).title)).toBe(250);
  });
});

describe('sendPushover', () => {
  it('通常の優先度でフォーム送信する', async () => {
    const seen: { url?: string; body?: URLSearchParams } = {};
    const fake = (async (url: string, init?: RequestInit) => {
      seen.url = url;
      seen.body = init?.body as URLSearchParams;
      return new Response(JSON.stringify({ status: 1 }), { status: 200 });
    }) as typeof fetch;
    await sendPushover('app-token', 'user-key', buildNowMessage(base), fake);
    expect(seen.url).toBe('https://api.pushover.net/1/messages.json');
    expect(seen.body?.get('token')).toBe('app-token');
    expect(seen.body?.get('user')).toBe('user-key');
    expect(seen.body?.get('priority')).toBe('0');
    expect(seen.body?.get('url_title')).toBe('Gmailで開く');
  });
  it('Pushoverが受け付けなければ例外にする(次回に再送するため)', async () => {
    const fake = (async () => new Response(JSON.stringify({ status: 0, errors: ['user key is invalid'] }), { status: 400 })) as typeof fetch;
    await expect(sendPushover('a', 'u', { title: 't', message: 'm' }, fake)).rejects.toThrow('pushover 400');
  });
});
