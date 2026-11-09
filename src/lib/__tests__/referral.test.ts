import { describe, it, expect } from 'vitest';
import { normalizeKana, matchReferrer, pickReferrerKana, referrerMatchLabel } from '../referral';
import { buildTrialGroups, type TrialRow } from '../trialNotify';
import { buildTrialCalendarEvents, buildReferralBlock } from '../trialCalendarEvents';

const members = [
  { id: 1, full_name_kana: 'センダイ ハナコ' },
  { id: 2, full_name_kana: 'ヤマダ タロウ' },
  { id: 3, full_name_kana: 'ヤマダ タロウ' },
];

describe('normalizeKana', () => {
  it('空白とひらがなの違いを吸収', () => expect(normalizeKana('せんだい　はなこ')).toBe(normalizeKana('センダイハナコ')));
  it('長音は残す', () => expect(normalizeKana('ユーリ')).toBe('ユーリ'));
});

describe('matchReferrer', () => {
  it('1人一致', () => expect(matchReferrer('センダイハナコ', members)).toEqual({ status: 'match', memberIds: [1] }));
  it('同姓同名は要確認', () => expect(matchReferrer('ヤマダ タロウ', members).status).toBe('ambiguous'));
  it('見つからない', () => expect(matchReferrer('スズキ イチロウ', members).status).toBe('none'));
  it('空は none', () => expect(matchReferrer('', members).status).toBe('none'));
  it('文言', () => expect(referrerMatchLabel({ status: 'match', memberIds: [1] })).toBe('会員名簿と一致'));
});

describe('pickReferrerKana', () => {
  it('紹介者の列を拾う', () =>
    expect(pickReferrerKana({ 'お名前': 'A', 'ご紹介者のお名前（カタカナ）': 'センダイ ハナコ' })).toBe('センダイ ハナコ'));
  it('姓名に分かれていてもつなぐ', () =>
    expect(pickReferrerKana({ 'ご紹介者のお名前（カタカナ）(セイ)': 'センダイ', 'ご紹介者のお名前（カタカナ）(メイ)': 'ハナコ' })).toBe('センダイ ハナコ'));
  it('列が無ければ null', () => expect(pickReferrerKana({ 'お名前': 'A' })).toBeNull());
});

const row = (o: Partial<TrialRow>): TrialRow => ({
  reserved_at: '2026-11-15 15:00:00', lesson_name: '(日) 15:00～ 大人ベーシック', status: '予約済',
  applicant_name: 'x', applicant_name_kana: 'イトウ ユミ', applicant_age: 58,
  course_type: '体験レッスン', dance_experience: '未経験', referral_source: 'ご紹介（お友だち・ご家族）', ...o,
});

describe('カレンダーの紹介表示', () => {
  it('紹介者があれば🎁と説明が付き、講師向け周知文には出ない', () => {
    const g = buildTrialGroups([row({ referrer_kana: 'センダイ ハナコ' })]);
    const [ev] = buildTrialCalendarEvents(g, [], () => '会員名簿と一致');
    expect(ev.summary.endsWith('🎁')).toBe(true);
    expect(ev.description).toContain('紹介者 センダイ ハナコ（会員名簿と一致）');
    expect(g[0].copyText).not.toContain('センダイ');
  });
  it('紹介者が無ければ何も足さない', () => {
    const g = buildTrialGroups([row({})]);
    expect(buildReferralBlock(g[0], () => '')).toBe('');
    expect(buildTrialCalendarEvents(g, [])[0].summary.endsWith('🎁')).toBe(false);
  });
});
