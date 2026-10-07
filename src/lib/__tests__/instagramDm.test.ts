import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifySignature, parseWebhookEvents, withinReplyWindow } from '../instagramDm';
import { decideAutoReply, classify, looksLikeApplication, statusAfter, MAX_AUTO_PER_DAY, WS_INFO, AUTO_NOTE, renderTemplate, TEMPLATES } from '../instagramDmRules';

const NOW = '2026-10-07T12:00:00+09:00';
const AFTER_WS = '2026-10-26T12:00:00+09:00';
const baseCtx = { autoReplyKinds: [], autoRepliesLast24h: 0, inboundCountBefore: 0, now: NOW };

describe('verifySignature', () => {
  it('正しい署名だけ通す', () => {
    const body = '{"object":"instagram"}';
    const sig = 'sha256=' + createHmac('sha256', 'secret').update(body).digest('hex');
    expect(verifySignature(body, sig, 'secret')).toBe(true);
    expect(verifySignature(body, sig, 'other')).toBe(false);
    expect(verifySignature(body + ' ', sig, 'secret')).toBe(false);
    expect(verifySignature(body, null, 'secret')).toBe(false);
    expect(verifySignature(body, 'sha1=abc', 'secret')).toBe(false);
  });
});

describe('parseWebhookEvents', () => {
  it('messaging[] 形式からテキストDMを取り出す', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: '17841400000000000',
          time: 1759800000000,
          messaging: [
            {
              sender: { id: '111' },
              recipient: { id: '17841400000000000' },
              timestamp: 1759800000000,
              message: { mid: 'm1', text: 'ワークショップ参加したいです' },
            },
            { sender: { id: '111' }, recipient: { id: '17841400000000000' }, timestamp: 1, read: { mid: 'm1' } },
          ],
        },
      ],
    };
    const ev = parseWebhookEvents(payload);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ senderId: '111', mid: 'm1', text: 'ワークショップ参加したいです', isEcho: false });
  });

  it('画像だけのDMは本文空+添付で返す / echo を印付けする', () => {
    const payload = {
      object: 'instagram',
      entry: [
        {
          id: 'x',
          messaging: [
            { sender: { id: '222' }, recipient: { id: 'x' }, message: { mid: 'm2', attachments: [{ type: 'image', payload: { url: 'https://img' } }] } },
            { sender: { id: 'x' }, recipient: { id: '222' }, message: { mid: 'm3', text: 'こちらから', is_echo: true } },
          ],
        },
      ],
    };
    const ev = parseWebhookEvents(payload);
    expect(ev[0]).toMatchObject({ text: '', attachments: [{ type: 'image', url: 'https://img' }] });
    expect(ev[1].isEcho).toBe(true);
  });

  it('object が instagram 以外・壊れた本文は空', () => {
    expect(parseWebhookEvents({ object: 'page', entry: [] })).toEqual([]);
    expect(parseWebhookEvents(null)).toEqual([]);
  });
});

describe('classify / looksLikeApplication', () => {
  it('WS関連キーワードは ws、名前・人数つきは ws_apply', () => {
    expect(classify('10/25のワークショップについて教えてください', NOW)).toBe('ws');
    expect(classify('唯愛さんのWS 2人で参加したいです', NOW)).toBe('ws_apply');
    expect(classify('山田です。1名でお願いします', NOW, true)).toBe('ws_apply');
  });
  it('WS期間が終わったら ws に落ちない', () => {
    expect(classify('ワークショップありますか', AFTER_WS)).toBeNull();
    expect(classify('体験したいです', AFTER_WS)).toBe('trial');
  });
  it('体験系は trial、それ以外は null', () => {
    expect(classify('体験レッスンは何歳からですか', NOW)).toBe('trial');
    expect(classify('こんにちは', NOW)).toBeNull();
  });
  it('人数表現・電話番号を拾う', () => {
    expect(looksLikeApplication('２名で')).toBe(true);
    expect(looksLikeApplication('ひとりで行きます')).toBe(true);
    expect(looksLikeApplication('木村です 090-1234-5678')).toBe(true);
    expect(looksLikeApplication('佐藤 ０９０１２３４５６７８')).toBe(true);
    expect(looksLikeApplication('ありがとうございます')).toBe(false);
    expect(looksLikeApplication('10/25 15:45からですか')).toBe(false);
  });
  it('案内文にお名前と電話番号とキャンセルの注意が入っている', () => {
    expect(WS_INFO.text).toMatch(/お名前/);
    expect(WS_INFO.text).toMatch(/電話番号/);
    expect(WS_INFO.text).toMatch(/キャンセル/);
  });
});

describe('decideAutoReply', () => {
  it('初回の雑談には greeting を返す', () => {
    const d = decideAutoReply('こんにちは！', baseCtx);
    expect(d.kind).toBe('greeting');
  });
  it('お礼・相槌だけには返さない', () => {
    const d = decideAutoReply('ありがとうございます！', { ...baseCtx, inboundCountBefore: 1, autoReplyKinds: ['greeting'] });
    expect(d.kind).toBeNull();
  });
  it('2通目以降で定型に当たらなければ「スタッフが返す」と伝えて止める(handoff)', () => {
    const d = decideAutoReply('来月もやりますか？', { ...baseCtx, inboundCountBefore: 1, autoReplyKinds: ['ws'] });
    expect(d.kind).toBe('handoff');
  });
  it('同じ案内を繰り返し聞かれたら2回送らずに handoff', () => {
    const d = decideAutoReply('ワークショップについて', { ...baseCtx, inboundCountBefore: 1, autoReplyKinds: ['ws'] });
    expect(d.kind).toBe('handoff');
  });
  it('「違う」「自動ですか」など噛み合っていないサインは即 handoff', () => {
    expect(decideAutoReply('いや、そうじゃなくて体験の話です', { ...baseCtx, inboundCountBefore: 1, autoReplyKinds: ['ws'] }).kind).toBe('handoff');
    expect(decideAutoReply('これ自動ですか？', baseCtx).kind).toBe('handoff');
  });
  it('handoff を送った後は何が来ても自動では返さない', () => {
    const d = decideAutoReply('ワークショップ 2名で', { ...baseCtx, inboundCountBefore: 3, autoReplyKinds: ['ws', 'handoff'] });
    expect(d.kind).toBeNull();
  });
  it('自動送信の断りが定型文に付く(handoff以外)', () => {
    expect(renderTemplate('ws')).toContain(AUTO_NOTE);
    expect(renderTemplate('ws_apply')).toContain(AUTO_NOTE);
    expect(renderTemplate('handoff')).not.toContain(AUTO_NOTE);
    expect(renderTemplate('handoff')).toMatch(/担当者|スタッフ/);
    expect(Object.values(TEMPLATES).join('\n')).not.toMatch(/TARO|早めに/);
  });
  it('ws案内のあとに名前・人数が来たら ws_apply', () => {
    const d = decideAutoReply('佐藤です、2名でお願いします', { ...baseCtx, inboundCountBefore: 1, autoReplyKinds: ['ws'] });
    expect(d.kind).toBe('ws_apply');
  });
  it('本文なし・24時間上限では返さない', () => {
    expect(decideAutoReply('', baseCtx).kind).toBeNull();
    expect(decideAutoReply('ワークショップ', { ...baseCtx, autoRepliesLast24h: MAX_AUTO_PER_DAY }).kind).toBeNull();
  });
  it('定型文に広告臭の記号を入れない', () => {
    expect(WS_INFO.text).not.toMatch(/✅|！！|今すぐ/);
  });
});

describe('statusAfter / withinReplyWindow', () => {
  it('案内だけで済むものは auto_replied、申込・不明は needs_reply', () => {
    expect(statusAfter('ws')).toBe('auto_replied');
    expect(statusAfter('trial')).toBe('auto_replied');
    expect(statusAfter('ws_apply')).toBe('needs_reply');
    expect(statusAfter('greeting')).toBe('needs_reply');
    expect(statusAfter('handoff')).toBe('needs_reply');
    expect(statusAfter(null)).toBe('needs_reply');
  });
  it('24時間ウィンドウ', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(withinReplyWindow('2026-10-07T00:00:00Z', now)).toBe(true);
    expect(withinReplyWindow('2026-10-06T11:59:00Z', now)).toBe(false);
  });
});
