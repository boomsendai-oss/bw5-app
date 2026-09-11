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
  receivedMs: Date.UTC(2026, 8, 11, 3, 10),
};

function capture(json: unknown, status = 200) {
  const seen: { url?: string; body?: URLSearchParams } = {};
  const fake = (async (url: string, init?: RequestInit) => {
    seen.url = url;
    seen.body = init?.body as URLSearchParams;
    return new Response(JSON.stringify(json), { status });
  }) as typeof fetch;
  return { seen, fake };
}

describe('displaySender', () => {
  it('表示名があれば表示名(引用符なし・エスケープ・山括弧入りも)', () => {
    expect(displaySender('"山田" <p@gmail.com>')).toBe('山田');
    expect(displaySender('山田 花子 <a@b.jp>')).toBe('山田 花子');
    expect(displaySender('"a \\"b\\" c" <a@b.jp>')).toBe('a "b" c');
    expect(displaySender('"A<B" <a@b.jp>')).toBe('A<B');
  });
  it('表示名が無ければドメインだけ(お客さんのアドレスを出さない)、空なら(不明)', () => {
    expect(displaySender('<p@gmail.com>')).toBe('gmail.com');
    expect(displaySender('p@gmail.com')).toBe('gmail.com');
    expect(displaySender('')).toBe('(不明)');
  });
  it('表示名のURLは消す', () => {
    expect(displaySender('"至急 https://evil.example/x" <a@b.jp>')).toBe('至急 [URL]');
  });
});

describe('gmailLink', () => {
  it('アカウントを指定してスレッドを開くURL', () => {
    expect(gmailLink('boom.sendai@gmail.com', 'abc')).toBe('https://mail.google.com/mail/u/?authuser=boom.sendai%40gmail.com#all/abc');
  });
});

describe('buildNowMessage', () => {
  it('種類の見出し＋件名をタイトルに、差出人と要約を本文にし、受信時刻を秒で付ける', () => {
    expect(buildNowMessage(base)).toEqual({
      title: '【新規の問い合わせ】体験レッスンの相談',
      message: '差出人: 山田\n要約: 体験の相談',
      url: 'https://mail.google.com/x',
      url_title: 'Gmailで開く',
      timestamp: Math.floor(base.receivedMs / 1000),
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
  it('件名のURLは消す', () => {
    expect(buildNowMessage({ ...base, subject: 'ご確認ください https://evil.example/login' }).title)
      .toBe('【新規の問い合わせ】ご確認ください [URL]');
  });
});

describe('sendPushover', () => {
  it('通常の優先度でフォーム送信し、受信時刻を付ける', async () => {
    const { seen, fake } = capture({ status: 1 });
    await sendPushover('app-token', 'user-key', buildNowMessage(base), fake);
    expect(seen.url).toBe('https://api.pushover.net/1/messages.json');
    expect(seen.body?.get('token')).toBe('app-token');
    expect(seen.body?.get('user')).toBe('user-key');
    expect(seen.body?.get('priority')).toBe('0');
    expect(seen.body?.get('url_title')).toBe('Gmailで開く');
    expect(seen.body?.get('timestamp')).toBe(String(Math.floor(base.receivedMs / 1000)));
  });
  it('URLや時刻が無ければその欄を送らない(警報・朝のまとめ)', async () => {
    const { seen, fake } = capture({ status: 1 });
    await sendPushover('a', 'u', { title: 't', message: 'm' }, fake);
    expect(seen.body?.has('url')).toBe(false);
    expect(seen.body?.has('timestamp')).toBe(false);
  });
  it('Pushoverが受け付けなければ例外にする(次回に再送するため)', async () => {
    const { fake } = capture({ status: 0, errors: ['user key is invalid'] }, 400);
    await expect(sendPushover('a', 'u', { title: 't', message: 'm' }, fake)).rejects.toThrow('pushover 400');
  });
  it('HTTP 200 でも status が 1 でなければ例外にする', async () => {
    const { fake } = capture({ status: 0 }, 200);
    await expect(sendPushover('a', 'u', { title: 't', message: 'm' }, fake)).rejects.toThrow('pushover 200');
  });
});
