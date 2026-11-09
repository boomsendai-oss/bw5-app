import { describe, it, expect, vi } from 'vitest';

// autoLink は linkSuggest(→ ./db) を import するのでDBをモックして隔離する。
vi.mock('../db', () => ({
  getOne: vi.fn(),
  getAll: vi.fn(),
  execute: vi.fn(),
}));

import { decideAutoLinks, surnameKana } from '../autoLink';
import type { LinkCandidate, LinkSuggestion } from '../linkSuggest';

function cand(over: Partial<LinkCandidate> = {}): LinkCandidate {
  return {
    lstep_id: 'L1',
    system_display_name: '',
    line_register_name: '',
    customer_kana: '',
    score: 120,
    confidence: '高',
    reasons: ['体験予約カナ名一致', 'LINE種別: 保護者LINE(年齢9歳(≤12))'],
    relation_suggestion: '保護者',
    line_type: '保護者LINE',
    source: '体験予約',
    match_key: 'カナ',
    ...over,
  };
}

function sug(memberId: number, kana: string, candidates: LinkCandidate[]): LinkSuggestion {
  return { member_id: memberId, hacomono_member_id: `H${memberId}`, full_name: 'テスト', full_name_kana: kana, candidates };
}

const base = {
  existingLinks: [],
  activeFriendIds: new Set(['L1', 'L2', 'L3']),
  memberKanaCount: new Map([['ヤマダタロウ', 1], ['ヤマダハナコ', 1], ['サトウジロウ', 1]]),
};

describe('surnameKana', () => {
  it('空白区切りの先頭を姓として正規化', () => {
    expect(surnameKana('やまだ　たろう')).toBe('ヤマダ');
    expect(surnameKana('ヤマダ タロウ')).toBe('ヤマダ');
  });
  it('空白が無ければ判定不能として空', () => {
    expect(surnameKana('ヤマダタロウ')).toBe('');
    expect(surnameKana(null)).toBe('');
  });
});

describe('decideAutoLinks', () => {
  it('体験予約カナ一致・確度高・候補1つなら自動でひもづける', () => {
    const r = decideAutoLinks({ ...base, suggestions: [sug(1, 'ヤマダ タロウ', [cand()])] });
    expect(r.links).toEqual([{ member_id: 1, hacomono_member_id: 'H1', lstep_id: 'L1', relation: '保護者' }]);
    expect(r.skipped).toHaveLength(0);
  });

  it('表示名由来の候補は数えない(体験予約の候補が無ければ見送り・曖昧扱いにもしない)', () => {
    const r = decideAutoLinks({
      ...base,
      suggestions: [sug(1, 'ヤマダ タロウ', [cand({ source: 'Lstep表示名', score: 130, match_key: undefined })])],
    });
    expect(r.links).toHaveLength(0);
    expect(r.skipped).toHaveLength(0);
    expect(r.noTrialCandidate).toBe(1);
  });

  it('表示名由来の候補が別にあっても、体験予約の候補が1つなら自動にする', () => {
    const r = decideAutoLinks({
      ...base,
      suggestions: [sug(1, 'ヤマダ タロウ', [cand(), cand({ lstep_id: 'L2', source: 'Lstep表示名', score: 80, confidence: '中' })])],
    });
    expect(r.links.map((l) => l.lstep_id)).toEqual(['L1']);
  });

  it('体験予約の候補が複数なら見送り', () => {
    const r = decideAutoLinks({ ...base, suggestions: [sug(1, 'ヤマダ タロウ', [cand(), cand({ lstep_id: 'L2' })])] });
    expect(r.links).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/候補が2件/);
  });

  it('確度が中(要確認の中高生・年齢不一致など)は見送り', () => {
    const r = decideAutoLinks({
      ...base,
      suggestions: [sug(1, 'ヤマダ タロウ', [cand({ confidence: '中', line_type: '要確認', reasons: ['体験予約カナ名一致', 'LINE種別: 要確認(年齢15歳(要確認))'] })])],
    });
    expect(r.links).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/確度が中/);
  });

  it('漢字氏名だけの一致は見送り', () => {
    const r = decideAutoLinks({ ...base, suggestions: [sug(1, 'ヤマダ タロウ', [cand({ match_key: '漢字' })])] });
    expect(r.links).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/漢字/);
  });

  it('講師は自動にしない', () => {
    const r = decideAutoLinks({ ...base, suggestions: [sug(1, 'ヤマダ タロウ', [cand({ relation_suggestion: '講師' })])] });
    expect(r.links).toHaveLength(0);
  });

  it('ブロック中・友だち一覧に無いLINEは見送り', () => {
    const r = decideAutoLinks({ ...base, suggestions: [sug(1, 'ヤマダ タロウ', [cand({ lstep_id: 'GONE' })])] });
    expect(r.links).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/ブロック/);
  });

  it('同じカナ名の会員が他にいれば見送り', () => {
    const r = decideAutoLinks({
      ...base,
      memberKanaCount: new Map([['ヤマダタロウ', 2]]),
      suggestions: [sug(1, 'ヤマダ タロウ', [cand()])],
    });
    expect(r.links).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/同じカナ名/);
  });

  it('既に別の会員にひもづくLINEは、別の姓なら見送り', () => {
    const r = decideAutoLinks({
      ...base,
      existingLinks: [{ member_id: 9, lstep_id: 'L1', member_full_name_kana: 'サトウ ジロウ' }],
      suggestions: [sug(1, 'ヤマダ タロウ', [cand()])],
    });
    expect(r.links).toHaveLength(0);
    expect(r.skipped[0].reason).toMatch(/別の会員/);
  });

  it('既に兄弟(同じ姓)がひもづく保護者LINEなら追加する', () => {
    const r = decideAutoLinks({
      ...base,
      existingLinks: [{ member_id: 9, lstep_id: 'L1', member_full_name_kana: 'ヤマダ ハナコ' }],
      suggestions: [sug(1, 'ヤマダ タロウ', [cand()])],
    });
    expect(r.links).toHaveLength(1);
  });

  it('同じ姓でも「本人」としてのひもづけは、別会員のLINEなら見送り', () => {
    const r = decideAutoLinks({
      ...base,
      existingLinks: [{ member_id: 9, lstep_id: 'L1', member_full_name_kana: 'ヤマダ ハナコ' }],
      suggestions: [sug(1, 'ヤマダ タロウ', [cand({ relation_suggestion: '本人', line_type: '本人LINE' })])],
    });
    expect(r.links).toHaveLength(0);
  });

  it('今回の自動分どうしで同じLINEを取り合う: 同じ姓の保護者なら両方、違えば両方見送り', () => {
    const sib = decideAutoLinks({
      ...base,
      suggestions: [sug(1, 'ヤマダ タロウ', [cand()]), sug(2, 'ヤマダ ハナコ', [cand()])],
    });
    expect(sib.links.map((l) => l.member_id)).toEqual([1, 2]);

    const other = decideAutoLinks({
      ...base,
      suggestions: [sug(1, 'ヤマダ タロウ', [cand()]), sug(3, 'サトウ ジロウ', [cand()])],
    });
    expect(other.links).toHaveLength(0);
    expect(other.skipped).toHaveLength(2);
  });
});
