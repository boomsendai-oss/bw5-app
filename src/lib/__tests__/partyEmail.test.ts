import { describe, it, expect } from 'vitest';
import { buildPartyOrderEmail, buildAudioReminderEmail, buildLinkResendEmail } from '../partyEmail';
import { DEFAULT_PARTY_SETTINGS } from '../party';
import type { PartyOrder } from '../partyDb';

const base: PartyOrder = {
  id: 7, eventKey: 'xmas2026', kind: 'ticket', buyerName: '木村 太郎', buyerKana: 'きむら たろう',
  email: 't@example.com', phone: '09012345678', isMember: true, peopleCount: 3, infantCount: 1,
  teamName: '', teamKana: '', genre: '', memberCount: 0, members: [], payMethod: 'cash', status: 'cash_due',
  unitPrice: 2000, amountTotal: 6000, stripeSessionId: '', expiresAt: '', audioUrl: '', audioFilename: '', audioUploadedAt: '', audioRemindedAt: '',
  staffNote: '', createdAt: '2026-10-20T11:00:00.000Z',
};
const S = DEFAULT_PARTY_SETTINGS;

describe('buildPartyOrderEmail', () => {
  it('当日現金: キャッシャーで払う金額(注文の合計)を書く', () => {
    const m = buildPartyOrderEmail(base, 'tok', S);
    expect(m.subject).toContain('【BOOMクリスマスパーティー2026】');
    expect(m.subject).toContain('X26-007');
    expect(m.subject).toContain('チケット予約');
    expect(m.text).toContain('¥6,000');
    expect(m.text).toContain('当日、会場のキャッシャーで');
    expect(m.text).toContain('未就学児 1名(無料)');
    expect(m.text).toContain('1ドリンク ¥600');
    expect(m.text).toContain('原則として返金はできません');
    expect(m.text).toContain('/xmas/my?t=tok');
  });
  it('カード: 支払い済み', () => {
    const m = buildPartyOrderEmail({ ...base, payMethod: 'card', status: 'paid' }, 'tok', S);
    expect(m.text).toContain('カード決済でお支払い済み');
    expect(m.text).not.toContain('キャッシャーで ¥');
  });
  it('エントリー: チームとメンバー・音源の締切', () => {
    const m = buildPartyOrderEmail(
      { ...base, kind: 'entry', teamName: 'BOOM KIDS', teamKana: 'ぶーむきっず', genre: 'HIPHOP', memberCount: 2, members: [{ name: 'あ', grade: 'g1_3' }, { name: 'い', grade: 'hs' }], unitPrice: 4000, amountTotal: 8000, peopleCount: 0, infantCount: 0, isMember: null },
      'tok',
      S
    );
    expect(m.subject).toContain('出演エントリー');
    expect(m.text).toContain('BOOM KIDS');
    expect(m.text).toContain('・あ(小学1〜3年生)');
    expect(m.text).toContain('リハーサルの時間はありません');
    expect(m.text).toContain('音源の提出(後日でOK)');
    expect(m.text).toContain('12/12(土) 23:59');
    expect(m.text).toContain('¥8,000');
    expect(m.text).toContain('チケット予約は不要');
  });
});

describe('音源リマインド・控えの再送', () => {
  it('リマインドに提出ページと締切', () => {
    const m = buildAudioReminderEmail({ ...base, kind: 'entry', teamName: 'BOOM KIDS' }, 'tok', S);
    expect(m.subject).toContain('BOOM KIDS');
    expect(m.text).toContain('/xmas/my?t=tok');
    expect(m.text).toContain('12/12(土) 23:59');
  });
  it('再送は申込ごとのURLを並べる', () => {
    const m = buildLinkResendEmail([
      { order: base, token: 't1' },
      { order: { ...base, id: 8, kind: 'entry', teamName: 'A' }, token: 't2' },
    ]);
    expect(m.text).toContain('X26-007 チケット予約');
    expect(m.text).toContain('/xmas/my?t=t2');
  });
});

describe('音源の受付お知らせ', () => {
  it('チーム名・ファイル名・提出ページを書く', async () => {
    const { buildAudioReceivedEmail } = await import('../partyEmail');
    const m = buildAudioReceivedEmail({ ...base, kind: 'entry', teamName: 'BOOM KIDS' }, 'song.mp3');
    expect(m.subject).toContain('BOOM KIDS');
    expect(m.text).toContain('song.mp3');
    expect(m.text).toContain('/xmas/audio');
    expect(m.text).toContain('身に覚えのない');
  });
});
