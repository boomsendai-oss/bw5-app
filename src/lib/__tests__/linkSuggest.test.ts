import { describe, it, expect, vi } from 'vitest';

// linkSuggest の純関数群 (M12降格ロジック / scoreCandidate / classifyLineType)。
// モジュールが ./db を import しているためモックして隔離する。
vi.mock('../db', () => ({
  getOne: vi.fn(),
  getAll: vi.fn(),
  execute: vi.fn(),
}));

import {
  demoteTrialCandidate,
  scoreCandidate,
  classifyLineType,
  ageFromBirthday,
  normalizeKana,
  type Member,
  type LstepFriend,
  type ExistingLink,
} from '../linkSuggest';

// ── M12: demoteTrialCandidate (降格方向のみ) ──

describe('demoteTrialCandidate (M12)', () => {
  it('同名複数(matchedCount>1)なら降格 + 理由「同名複数・要確認」', () => {
    const d = demoteTrialCandidate({ matchedCount: 2, birthdayAge: null, trialAge: null });
    expect(d.demote).toBe(true);
    expect(d.reasons).toContain('同名複数・要確認');
  });

  it('単一マッチ・年齢情報なしは降格しない', () => {
    const d = demoteTrialCandidate({ matchedCount: 1, birthdayAge: null, trialAge: null });
    expect(d.demote).toBe(false);
    expect(d.reasons).toHaveLength(0);
  });

  it('birthday由来年齢と体験時年齢が許容差(3年)超なら降格 (親子同名の取り違え検出)', () => {
    const d = demoteTrialCandidate({ matchedCount: 1, birthdayAge: 36, trialAge: 8 });
    expect(d.demote).toBe(true);
    expect(d.reasons.some((r) => r.includes('年齢不一致'))).toBe(true);
  });

  it('経年由来の±1〜3年の差は降格しない', () => {
    expect(demoteTrialCandidate({ matchedCount: 1, birthdayAge: 9, trialAge: 8 }).demote).toBe(false);
    expect(demoteTrialCandidate({ matchedCount: 1, birthdayAge: 11, trialAge: 8 }).demote).toBe(false);
  });

  it('片方の年齢が不明なら年齢では降格しない', () => {
    expect(demoteTrialCandidate({ matchedCount: 1, birthdayAge: 36, trialAge: null }).demote).toBe(false);
    expect(demoteTrialCandidate({ matchedCount: 1, birthdayAge: null, trialAge: 8 }).demote).toBe(false);
  });

  it('同名複数かつ年齢不一致なら理由は両方付く', () => {
    const d = demoteTrialCandidate({ matchedCount: 3, birthdayAge: 40, trialAge: 10 });
    expect(d.reasons).toHaveLength(2);
  });
});

// ── scoreCandidate (フォールバック突合の回帰確認) ──

const member = (over: Partial<Member> = {}): Member => ({
  id: 1,
  hacomono_member_id: 'H001',
  full_name: '阿部 聖奈',
  full_name_kana: 'アベ セイナ',
  ...over,
});

const friend = (over: Partial<LstepFriend> = {}): LstepFriend => ({
  lstep_id: 'U1',
  display_name: null,
  system_display_name: null,
  line_register_name: null,
  real_name: null,
  customer_kana: null,
  ...over,
});

describe('scoreCandidate', () => {
  it('姓カナ+名カナ一致で score>=80 の候補になる', () => {
    const s = scoreCandidate(member(), friend({ system_display_name: 'アベセイナ' }), []);
    expect(s).not.toBeNull();
    expect(s!.score).toBeGreaterThanOrEqual(80);
    expect(s!.reasons).toContain('姓カナ一致');
    expect(s!.reasons).toContain('名カナ一致');
  });

  it('姓のみ一致(50点)は閾値60未満で null', () => {
    const s = scoreCandidate(member(), friend({ system_display_name: 'アベ' }), []);
    expect(s).toBeNull();
  });

  it('兄弟紐付け済みボーナスで relation=保護者になる', () => {
    const links: ExistingLink[] = [
      { member_id: 99, lstep_id: 'U1', relation: '保護者', member_full_name_kana: 'アベ ユウト' },
    ];
    const s = scoreCandidate(member(), friend({ system_display_name: 'アベ' }), links);
    expect(s).not.toBeNull();
    expect(s!.relation).toBe('保護者');
  });

  it('表示名に「講師」があれば relation=講師', () => {
    const s = scoreCandidate(member(), friend({ system_display_name: 'アベセイナ(講師)' }), []);
    expect(s!.relation).toBe('講師');
  });
});

// ── classifyLineType / ageFromBirthday / normalizeKana (境界の回帰確認) ──

describe('classifyLineType', () => {
  it('続柄=母 は保護者LINE', () => {
    expect(
      classifyLineType({ age: null, guardianRelation: '母', hasRep: false, siblingCount: 1 }).line_type
    ).toBe('保護者LINE');
  });
  it('18歳以上・代表なしは本人LINE', () => {
    expect(
      classifyLineType({ age: 20, guardianRelation: null, hasRep: false, siblingCount: 1 }).line_type
    ).toBe('本人LINE');
  });
  it('13〜17歳は要確認', () => {
    expect(
      classifyLineType({ age: 15, guardianRelation: null, hasRep: false, siblingCount: 1 }).line_type
    ).toBe('要確認');
  });
});

describe('ageFromBirthday / normalizeKana', () => {
  it('誕生日前後で年齢が変わる', () => {
    const today = new Date('2026-07-11T00:00:00Z');
    expect(ageFromBirthday('2000-07-11', today)).toBe(26);
    expect(ageFromBirthday('2000-07-12', today)).toBe(25);
  });
  it('四つ仮名・空白の正規化', () => {
    expect(normalizeKana('イマムラ　ミヅキ')).toBe('イマムラミズキ');
    expect(normalizeKana('あべ せいな')).toBe('アベセイナ');
  });
});
