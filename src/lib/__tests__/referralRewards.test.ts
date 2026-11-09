import { describe, it, expect } from 'vitest';
import { decideReferralTagTargets, decideNewRewards, ticketExpiry, buildRewardNotice, type ReferralTrial } from '../referralRewards';

const members = [
  { id: 1, full_name_kana: 'センダイ ハナコ', hacomono_member_id: '101' },
  { id: 2, full_name_kana: 'ヤマダ タロウ', hacomono_member_id: '102' },
  { id: 3, full_name_kana: 'ヤマダ タロウ', hacomono_member_id: '103' },
  { id: 9, full_name_kana: 'ニュウカイ ジロウ', hacomono_member_id: '109' },
];
const t = (o: Partial<ReferralTrial>): ReferralTrial => ({
  id: 1, lstep_id: 'L1', reserved_at: '2026-11-15 15:00:00', status: '予約済', referrer_kana: 'センダイハナコ', enrolled_member_id: null, ...o,
});

describe('decideReferralTagTargets', () => {
  it('1人一致だけ対象・決まらないものは unmatched', () => {
    const r = decideReferralTagTargets([t({}), t({ id: 2, lstep_id: 'L2', referrer_kana: 'ヤマダ タロウ' }), t({ id: 3, lstep_id: 'L3', referrer_kana: 'スズキ' })], members, '2026-11-09');
    expect(r.targets).toEqual([{ lstep_id: 'L1', trial_record_id: 1, referrer_member_id: 1 }]);
    expect(r.unmatched.map((u) => u.reason)).toEqual(['ambiguous', 'none']);
  });
  it('古い予約・キャンセル・LINE無しは見ない', () => {
    const r = decideReferralTagTargets([t({ reserved_at: '2026-11-01 10:00:00' }), t({ id: 2, status: 'キャンセル' }), t({ id: 3, lstep_id: null })], members, '2026-11-09');
    expect(r.targets).toHaveLength(0);
    expect(r.unmatched).toHaveLength(0);
  });
  it('同じLINEは1回だけ', () => {
    const r = decideReferralTagTargets([t({}), t({ id: 2, reserved_at: '2026-11-20 10:00:00' })], members, '2026-11-09');
    expect(r.targets).toHaveLength(1);
  });
});

describe('decideNewRewards', () => {
  it('入会済み×1人一致は pending', () => {
    const r = decideNewRewards([t({ enrolled_member_id: 9 })], members, new Set());
    expect(r[0]).toMatchObject({ status: 'pending', referrer_member_id: 1, referee_member_id: 9 });
  });
  it('未入会は対象外・既存は対象外', () => {
    expect(decideNewRewards([t({})], members, new Set())).toHaveLength(0);
    expect(decideNewRewards([t({ enrolled_member_id: 9 })], members, new Set([1]))).toHaveLength(0);
  });
  it('名簿で決まらない・自己紹介は needs_review', () => {
    const a = decideNewRewards([t({ enrolled_member_id: 9, referrer_kana: 'ヤマダタロウ' })], members, new Set());
    expect(a[0]).toMatchObject({ status: 'needs_review', note: '同じ名前の会員が複数' });
    const b = decideNewRewards([t({ enrolled_member_id: 1 })], members, new Set());
    expect(b[0]).toMatchObject({ status: 'needs_review', note: '紹介者と入会者が同じ' });
  });
  it('同じ入会者は1件だけ', () => {
    const r = decideNewRewards([t({ enrolled_member_id: 9 }), t({ id: 2, reserved_at: '2026-11-20 10:00:00', enrolled_member_id: 9 })], members, new Set());
    expect(r).toHaveLength(1);
    expect(r[0].trial_record_id).toBe(1);
  });
});

describe('ticketExpiry', () => {
  it('2か月後の同日', () => expect(ticketExpiry('2026-11-09')).toBe('2027-01-09'));
  it('月末は丸める', () => expect(ticketExpiry('2026-12-31')).toBe('2027-02-28'));
});

describe('buildRewardNotice', () => {
  it('pending の文面', () => {
    const n = buildRewardNotice({ status: 'pending', refereeNo: '109', referrerNo: '101', trialDate: '2026-11-15' });
    expect(n.message).toBe('紹介で入会：会員番号109（体験11/15）／紹介者 会員番号101 → チケット1回(2か月有効)を付けます');
  });
  it('needs_review の文面', () => {
    const n = buildRewardNotice({ status: 'needs_review', refereeNo: '109', referrerNo: null, trialDate: '2026-11-15', referrerKana: 'スズキ', note: '会員名簿に見つからない' });
    expect(n.message).toContain('名簿で決まりません');
  });
});
