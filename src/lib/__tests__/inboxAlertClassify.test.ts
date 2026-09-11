import { describe, it, expect } from 'vitest';
import {
  parseClassification,
  fallbackClassification,
  classifyMail,
  buildUserPrompt,
  type ModelReply,
} from '../inboxAlert/classify';
import { charLength } from '../inboxAlert/format';

const mail = {
  accountLabel: 'BOOM',
  from: '保護者 <p@gmail.com>',
  subject: '体験レッスンの相談',
  receivedIso: '2026-09-11T03:10:00.000Z',
  body: 'あ'.repeat(4000),
};
const reply = (text: string, stopReason: string | null = 'end_turn'): ModelReply => ({
  stopReason,
  text,
  inputTokens: 100,
  outputTokens: 20,
});

describe('parseClassification', () => {
  it('正しいJSONを判定結果にする', () => {
    expect(parseClassification('{"tier":"now","kind":"new_inquiry","summary":"体験の相談"}')).toEqual({
      tier: 'now', kind: 'new_inquiry', summary: '体験の相談', aiFailed: false,
    });
  });
  it('決められた値以外は null', () => {
    expect(parseClassification('{"tier":"urgent","kind":"new_inquiry","summary":""}')).toBeNull();
  });
  it('JSONでなければ null', () => {
    expect(parseClassification('すぐ通知してください')).toBeNull();
  });
  it('要約は60字に収める', () => {
    const r = parseClassification(JSON.stringify({ tier: 'now', kind: 'reply', summary: 'い'.repeat(70) }));
    expect(charLength(r!.summary)).toBe(60);
  });
});

describe('fallbackClassification', () => {
  it('全文を読むメールは鳴らす側、冒頭だけのメールはまとめに倒す', () => {
    expect(fallbackClassification('ai_full', 'x')).toMatchObject({ tier: 'now', aiFailed: true, error: 'x' });
    expect(fallbackClassification('ai_light', 'x')).toMatchObject({ tier: 'digest', aiFailed: true });
  });
});

describe('buildUserPrompt', () => {
  it('読み方に応じて本文を切り詰める(冒頭だけ=500字 / 全文=3000字)', () => {
    const light = buildUserPrompt(mail, 'ai_light');
    expect(light).toContain('あ'.repeat(499) + '…');
    expect(light).not.toContain('あ'.repeat(500));
    const full = buildUserPrompt(mail, 'ai_full');
    expect(full).toContain('あ'.repeat(2999) + '…');
    expect(full).toContain('件名: 体験レッスンの相談');
  });
});

describe('classifyMail', () => {
  it('AIの判定と使用トークンを返す', async () => {
    const r = await classifyMail(mail, 'ai_full', async () => reply('{"tier":"now","kind":"new_inquiry","summary":"体験の相談"}'));
    expect(r).toMatchObject({ tier: 'now', kind: 'new_inquiry', aiFailed: false, inputTokens: 100, outputTokens: 20 });
  });
  it('拒否されたらルール判定に切り替える', async () => {
    const r = await classifyMail(mail, 'ai_full', async () => reply('', 'refusal'));
    expect(r).toMatchObject({ tier: 'now', aiFailed: true, error: 'refusal' });
  });
  it('読めない返答もルール判定に切り替える', async () => {
    const r = await classifyMail(mail, 'ai_light', async () => reply('nope'));
    expect(r).toMatchObject({ tier: 'digest', aiFailed: true, error: 'unparseable' });
  });
  it('API例外(クレジット切れ等)もルール判定に切り替える', async () => {
    const r = await classifyMail(mail, 'ai_light', async () => { throw new Error('credit balance is too low'); });
    expect(r).toMatchObject({ tier: 'digest', aiFailed: true, error: 'credit balance is too low', inputTokens: 0 });
  });
});
