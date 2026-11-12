import { describe, it, expect } from 'vitest';
import { RECITAL_LINE_REPLIES, fillLineReply } from '../recitalLineReplies';

describe('公式LINEの返事のひな形（付録 D）', () => {
  it('10個とつなぎ1つ。題は付録 D のまま', () => {
    expect(RECITAL_LINE_REPLIES).toHaveLength(11);
    expect(RECITAL_LINE_REPLIES[0].title).toBe('振り込みました。届いていますか');
    expect(RECITAL_LINE_REPLIES[4].title).toBe('整理番号を付け忘れました（まちがえました）／去年の振込先に振り込みました');
    expect(RECITAL_LINE_REPLIES[10]).toMatchObject({ key: 'tsunagi', text: '確認して、お返事します。' });
  });
  it('期限は pay_due から曜日を計算して入れる・送り直しのURLを入れる・{ } が残らない', () => {
    const d = { refCode: '1007', remaining: 3000, payDue: '2027-02-10', resendUrl: 'https://example.test/bw6/resend' };
    const t10 = fillLineReply(RECITAL_LINE_REPLIES[9].text, d);
    expect(t10).toContain('2月10日（水）');
    expect(fillLineReply(RECITAL_LINE_REPLIES[8].text, d)).toContain('https://example.test/bw6/resend');
    for (const r of RECITAL_LINE_REPLIES) expect(fillLineReply(r.text, d)).not.toMatch(/[{}]/);
    expect(fillLineReply('{整理番号} {残り}', d)).toBe('1007 3,000円');
  });
});
