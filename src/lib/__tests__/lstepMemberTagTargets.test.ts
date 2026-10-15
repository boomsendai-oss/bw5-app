import { describe, it, expect } from 'vitest';
import { decideTargets, ageOn, type MemberRow } from '../lstepMemberTagTargets';

const member = (id: number, over: Partial<MemberRow> = {}): MemberRow => ({
  id, hacomono_member_id: String(100 + id), full_name: `山田 太郎${id}`, full_name_kana: `ヤマダ タロウ${id}`,
  member_type: 'regular', birthday: '1990-01-01', ...over,
});
const TODAY = '2026-10-15';

describe('ageOn', () => {
  it('誕生日前日までは前の年齢', () => {
    expect(ageOn('2008-10-16', TODAY)).toBe(17);
    expect(ageOn('2008-10-15', TODAY)).toBe(18);
  });
  it('読めなければ null', () => expect(ageOn(null, TODAY)).toBeNull());
});

describe('decideTargets', () => {
  it('確実な本人リンクは本人用、保護者リンクは保護者用', () => {
    const r = decideTargets({
      members: [member(1), member(2)],
      links: [
        { member_id: 1, lstep_id: 'A', relation: '本人', confidence: '確実' },
        { member_id: 2, lstep_id: 'B', relation: '保護者', confidence: '確実' },
      ],
      trials: [], today: TODAY,
    });
    expect(r.targets.map((t) => [t.lstepId, t.kind])).toEqual([['A', 'member'], ['B', 'guardian']]);
  });

  it('チケット会員も含め、講師・ビジター・休会は含めない', () => {
    const r = decideTargets({
      members: [member(1, { member_type: 'ticket' }), member(2, { member_type: 'staff' }),
                member(3, { member_type: 'visitor' }), member(4, { member_type: '休会' })],
      links: [1, 2, 3, 4].map((i) => ({ member_id: i, lstep_id: `L${i}`, relation: '本人', confidence: '確実' })),
      trials: [], today: TODAY,
    });
    expect(r.targets.map((t) => t.lstepId)).toEqual(['L1']);
  });

  it('推定のリンクは付けずに要確認へ', () => {
    const r = decideTargets({
      members: [member(1)],
      links: [{ member_id: 1, lstep_id: 'A', relation: '本人', confidence: '推定' }],
      trials: [], today: TODAY,
    });
    expect(r.targets).toEqual([]);
    expect(r.review[0].reason).toMatch(/推定/);
  });

  it('体験予約の照合は氏名とカナが両方一致したときだけ。子どもなら保護者用', () => {
    const kid = member(1, { full_name: '佐藤 花子', full_name_kana: 'サトウ ハナコ', birthday: '2016-05-01' });
    const r = decideTargets({
      members: [kid, member(2)],
      links: [],
      trials: [
        { lstep_id: 'K', enrolled_member_id: 1, applicant_name: '佐藤花子', applicant_name_kana: 'さとう はなこ', applicant_age: 10, parent_name: null },
        { lstep_id: 'X', enrolled_member_id: 2, applicant_name: '山田 次郎', applicant_name_kana: 'ヤマダ タロウ2', applicant_age: 36, parent_name: null },
      ],
      today: TODAY,
    });
    expect(r.targets.map((t) => [t.lstepId, t.kind, t.source])).toEqual([['K', 'guardian', 'trial']]);
    expect(r.review).toEqual([{ lstepId: 'X', memberRef: '102', reason: expect.stringMatching(/一致しない/) }]);
  });

  it('大人の体験予約は本人用', () => {
    const r = decideTargets({
      members: [member(1)], links: [],
      trials: [{ lstep_id: 'A', enrolled_member_id: 1, applicant_name: '山田太郎1', applicant_name_kana: 'ヤマダタロウ1', applicant_age: null, parent_name: null }],
      today: TODAY,
    });
    expect(r.targets[0]).toMatchObject({ lstepId: 'A', kind: 'member' });
  });

  it('同じアカウントが本人でも保護者でもあれば本人用', () => {
    const r = decideTargets({
      members: [member(1), member(2, { birthday: '2015-01-01' })],
      links: [
        { member_id: 2, lstep_id: 'P', relation: '保護者', confidence: '確実' },
        { member_id: 1, lstep_id: 'P', relation: '本人', confidence: '確実' },
      ],
      trials: [], today: TODAY,
    });
    expect(r.targets).toEqual([{ lstepId: 'P', kind: 'member', memberRefs: ['102', '101'], source: 'link' }]);
  });

  it('別の会員経由で確定したアカウントは要確認に残さない', () => {
    const r = decideTargets({
      members: [member(1), member(2)],
      links: [
        { member_id: 1, lstep_id: 'A', relation: '本人', confidence: '確実' },
        { member_id: 2, lstep_id: 'A', relation: '保護者', confidence: '推定' },
      ],
      trials: [], today: TODAY,
    });
    expect(r.review).toEqual([]);
  });

  it('保護者名の記入があれば年齢によらず保護者用', () => {
    const r = decideTargets({
      members: [member(1, { birthday: '2010-01-01' })], links: [],
      trials: [{ lstep_id: 'A', enrolled_member_id: 1, applicant_name: '山田太郎1', applicant_name_kana: 'ヤマダタロウ1', applicant_age: 16, parent_name: 'ヤマダ ハナコ' }],
      today: TODAY,
    });
    expect(r.targets[0]).toMatchObject({ lstepId: 'A', kind: 'guardian' });
  });

  it('中高生で保護者名の記入が無ければ自動では決めず人に回す', () => {
    const r = decideTargets({
      members: [member(1, { birthday: '2010-01-01' })], links: [],
      trials: [{ lstep_id: 'A', enrolled_member_id: 1, applicant_name: '山田太郎1', applicant_name_kana: 'ヤマダタロウ1', applicant_age: 16, parent_name: null }],
      today: TODAY,
    });
    expect(r.targets).toEqual([]);
    expect(r.review[0].reason).toMatch(/中高生/);
  });
});
