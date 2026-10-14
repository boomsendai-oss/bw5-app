import { describe, it, expect } from 'vitest';
import { buildPartyOrderEmail } from '../partyEmail';
import { DEFAULT_PARTY_SETTINGS } from '../party';
import type { PartyOrder } from '../partyDb';

const base: PartyOrder = {
  id: 7, eventKey: 'xmas2026', kind: 'ticket', buyerName: '木村 太郎', buyerKana: 'きむら たろう',
  email: 't@example.com', phone: '09012345678', isMember: true, peopleCount: 3, infantCount: 1,
  teamName: '', genre: '', memberCount: 0, members: [], payMethod: 'cash', status: 'cash_due',
  unitPrice: 2000, amountTotal: 6000, expiresAt: '', audioUrl: '', audioFilename: '', audioUploadedAt: '',
  staffNote: '', createdAt: '2026-10-20T11:00:00.000Z',
};
const S = DEFAULT_PARTY_SETTINGS;

describe('buildPartyOrderEmail', () => {
  it('当日現金: キャッシャーで払う金額(注文の合計)を書く', () => {
    const m = buildPartyOrderEmail(base, 'tok', S);
    expect(m.subject).toContain('【BOOMクリスマスパーティー2026】');
    expect(m.subject).toContain('X26-007');
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
      { ...base, kind: 'entry', teamName: 'BOOM KIDS', genre: 'HIPHOP', memberCount: 2, members: ['あ', 'い'], unitPrice: 4000, amountTotal: 8000, peopleCount: 0, infantCount: 0, isMember: null },
      'tok',
      S
    );
    expect(m.subject).toContain('出演エントリー');
    expect(m.text).toContain('BOOM KIDS');
    expect(m.text).toContain('あ、い');
    expect(m.text).toContain('12/12(土) 23:59');
    expect(m.text).toContain('¥8,000');
    expect(m.text).toContain('パーティーへの参加申込は不要');
  });
});
