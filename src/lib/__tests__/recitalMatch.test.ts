import { describe, it, expect } from 'vitest';
import { matchMember, matchFeePreset, normalizeBirthday, type MemberLite } from '../recitalMatch';

const m = (id: number, fullName: string, fullNameKana: string, birthday: string | null, status = 'active'): MemberLite =>
  ({ id, fullName, fullNameKana, birthday, status });
const P = (over: Partial<{ lastKana: string; firstKana: string; lastName: string; firstName: string; birthday: string | null }> = {}) =>
  ({ lastKana: 'ヤマダ', firstKana: 'ハナコ', lastName: '山田', firstName: '花子', birthday: '2015-04-03', ...over });

describe('生年月日の形', () => {
  it.each([
    ['2015-04-03', '2015-04-03'], ['2015-4-3', '2015-04-03'], ['2015/04/03', '2015-04-03'], ['2015/4/3', '2015-04-03'],
    ['20150403', '2015-04-03'], ['2015年4月3日', '2015-04-03'], ['２０１５－０４－０３', '2015-04-03'],
    ['2015-04-03 00:00:00', '2015-04-03'], ['2015-04-03T00:00:00.000Z', '2015-04-03'],
  ])('%s → %s', (s, want) => expect(normalizeBirthday(s)).toBe(want));
  it.each([[null], [''], ['2015-02-30'], ['04/03/2015'], ['不明']])('%s → null', (s) => expect(normalizeBirthday(s)).toBeNull());
});

describe('会員照合（05 5-8 の表）', () => {
  it('自動で合った：カナと生年月日が両方合う会員が1人だけ', () => {
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015/4/3'), m(2, '山田 太郎', 'ヤマダ タロウ', '2013-01-01')]))
      .toEqual({ status: 'auto', memberId: 1, candidateIds: [1], warn: null });
  });
  it('カナのゆれ（ひらがな・空白・半角・ヅ/ズ）はそろえて合わせる', () => {
    const mem = [m(1, '山田 花子', 'ヤマダ　ハナコ', '2015-04-03')];
    expect(matchMember(P({ lastKana: 'やまだ', firstKana: ' はなこ' }), mem).status).toBe('auto');
    expect(matchMember(P({ lastKana: 'ﾔﾏﾀﾞ', firstKana: 'ﾊﾅｺ' }), mem).status).toBe('auto');
    expect(matchMember(P({ firstKana: 'ミヅキ' }), [m(3, '山田 美月', 'ヤマダ ミズキ', '2015-04-03')]).status).toBe('auto');
  });
  it('確認待ち：生年月日がちがう／会員の誕生日が空／候補2人以上／漢字だけ合う', () => {
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-04')])).toMatchObject({ status: 'pending', memberId: null, candidateIds: [1] });
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', null)])).toMatchObject({ status: 'pending', candidateIds: [1] });
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03'), m(2, '山田 華子', 'ヤマダ ハナコ', '2015-04-03')]))
      .toMatchObject({ status: 'pending', candidateIds: [1, 2] });
    expect(matchMember(P(), [m(5, '山田 花子', 'ヤマダ ハナ', '2015-04-03')])).toMatchObject({ status: 'pending', candidateIds: [5] });
  });
  it('合わない：どれも合わない', () => {
    expect(matchMember(P(), [m(1, '佐藤 一郎', 'サトウ イチロウ', '2015-04-03')]))
      .toEqual({ status: 'unmatched', memberId: null, candidateIds: [], warn: null });
  });
  it('退会・休会の人と自動で合ったら警告（止めない）', () => {
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03', 'withdrew')]).warn).toBe('withdrawn');
    expect(matchMember(P(), [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03', 'leave')]).warn).toBe('leave');
  });
});

describe('特別な料金の事前登録（D4 2-10・直し8）', () => {
  const members = [m(1, '山田 花子', 'ヤマダ ハナコ', '2015-04-03'), m(2, '佐藤 一郎', 'サトウ イチロウ', '2010-10-10')];
  it('カナと生年月日の両方が合う登録の会員が1人だけなら、その種類', () => {
    expect(matchFeePreset(P(), [{ memberId: 1, feeClass: 'no_coop' }], members)).toEqual({ feeClass: 'no_coop', memberId: 1 });
  });
  it('カナだけ合う・生年月日が空・漢字だけ合う・2人以上は suspect（印は入れない）', () => {
    expect(matchFeePreset(P({ birthday: '2015-04-04' }), [{ memberId: 1, feeClass: 'free' }], members)).toEqual({ suspect: true });
    expect(matchFeePreset(P({ birthday: null }), [{ memberId: 1, feeClass: 'free' }], members)).toEqual({ suspect: true });
    expect(matchFeePreset(P({ firstKana: 'ハナ' }), [{ memberId: 1, feeClass: 'free' }], members)).toEqual({ suspect: true });
    const twins = [...members, m(3, '山田 華子', 'ヤマダ ハナコ', '2015-04-03')];
    expect(matchFeePreset(P(), [{ memberId: 1, feeClass: 'free' }, { memberId: 3, feeClass: 'tshirt_only' }], twins)).toEqual({ suspect: true });
  });
  it('登録の無い会員とだけ合う・だれとも合わないなら null', () => {
    expect(matchFeePreset(P(), [{ memberId: 2, feeClass: 'free' }], members)).toBeNull();
    expect(matchFeePreset(P({ lastKana: 'スズキ', lastName: '鈴木' }), [{ memberId: 1, feeClass: 'free' }], members)).toBeNull();
  });
});
