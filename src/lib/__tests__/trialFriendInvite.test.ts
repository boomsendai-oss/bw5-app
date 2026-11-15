import { describe, it, expect } from 'vitest';
import {
  commonPrefixLen,
  likelyDifferentFamily,
  detectFriendCobookings,
  type CobookingRow,
} from '../trialFriendInvite';

describe('commonPrefixLen', () => {
  it('先頭から一致する文字数を返す', () => {
    expect(commonPrefixLen('スズキタク', 'スズキハナ')).toBe(3);
    expect(commonPrefixLen('スズキ', 'オヤマ')).toBe(0);
    expect(commonPrefixLen('', 'オヤマ')).toBe(0);
  });
});

describe('likelyDifferentFamily', () => {
  it('カナがあればカナ先頭で別姓を判定（兄弟=同姓は false）', () => {
    expect(likelyDifferentFamily('鈴木琢', 'スズキタク', '鈴木花', 'スズキハナ')).toBe(false);
  });
  it('カナ先頭が全く違えば別姓 true（お友だち）', () => {
    expect(likelyDifferentFamily('鈴木琢', 'スズキタク', '小山晴加', 'オヤマセイカ')).toBe(true);
  });
  it('カナが欠けていれば漢字先頭で判定', () => {
    expect(likelyDifferentFamily('鈴木琢', null, '小山晴加', null)).toBe(true);
    expect(likelyDifferentFamily('鈴木琢', null, '鈴木花', null)).toBe(false);
  });
  it('先頭1文字でも共有していれば同姓扱い（保守的＝誤送信を避ける）', () => {
    // サトウ と サノ は「サ」を共有 → 別姓と断定しない
    expect(likelyDifferentFamily('佐藤A', 'サトウエー', '佐野B', 'サノビー')).toBe(false);
  });
  it('情報が足りなければ別姓と断定しない（false）', () => {
    expect(likelyDifferentFamily(null, null, '小山晴加', 'オヤマ')).toBe(false);
    expect(likelyDifferentFamily('', '', '小山晴加', 'オヤマ')).toBe(false);
  });
});

function row(p: Partial<CobookingRow>): CobookingRow {
  return {
    lstep_id: 'A',
    reserved_at: '2026-11-15 17:30:00',
    lesson_name: '(日) ちゃんなつ HIPHOP',
    status: '予約済',
    applicant_name: null,
    applicant_name_kana: null,
    applicant_age: null,
    ...p,
  };
}

describe('detectFriendCobookings', () => {
  it('同じ友だちID×同じ枠で名字の違う2人 → 候補1件（お友だち相乗り）', () => {
    const rows = [
      row({ applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' }),
      row({ applicant_name: '小山晴加', applicant_name_kana: 'オヤマセイカ' }),
    ];
    const c = detectFriendCobookings(rows);
    expect(c.length).toBe(1);
    expect(c[0].lstep_id).toBe('A');
    expect(c[0].reserved_at).toBe('2026-11-15 17:30:00');
    expect(c[0].applicants.map((a) => a.applicant_name).sort()).toEqual(['小山晴加', '鈴木琢'].sort());
  });

  it('兄弟（同姓）2人は候補にしない', () => {
    const rows = [
      row({ applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' }),
      row({ applicant_name: '鈴木花', applicant_name_kana: 'スズキハナ' }),
    ];
    expect(detectFriendCobookings(rows)).toEqual([]);
  });

  it('1人だけの枠は候補にしない', () => {
    const rows = [row({ applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' })];
    expect(detectFriendCobookings(rows)).toEqual([]);
  });

  it('別の枠（日時違い）は束ねない', () => {
    const rows = [
      row({ reserved_at: '2026-11-15 17:30:00', applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' }),
      row({ reserved_at: '2026-11-16 17:30:00', applicant_name: '小山晴加', applicant_name_kana: 'オヤマセイカ' }),
    ];
    expect(detectFriendCobookings(rows)).toEqual([]);
  });

  it('キャンセル・ノーショーは数えない（実質1人なら候補にしない）', () => {
    const rows = [
      row({ applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' }),
      row({ applicant_name: '小山晴加', applicant_name_kana: 'オヤマセイカ', status: 'キャンセル' }),
    ];
    expect(detectFriendCobookings(rows)).toEqual([]);
  });

  it('兄弟2人＋お友だち1人（名字違いが混ざる）→ 候補', () => {
    const rows = [
      row({ applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' }),
      row({ applicant_name: '鈴木花', applicant_name_kana: 'スズキハナ' }),
      row({ applicant_name: '小山晴加', applicant_name_kana: 'オヤマセイカ' }),
    ];
    const c = detectFriendCobookings(rows);
    expect(c.length).toBe(1);
    expect(c[0].applicants.length).toBe(3);
  });

  it('友だちIDが無い行は対象外', () => {
    const rows = [
      row({ lstep_id: null, applicant_name: '鈴木琢', applicant_name_kana: 'スズキタク' }),
      row({ lstep_id: null, applicant_name: '小山晴加', applicant_name_kana: 'オヤマセイカ' }),
    ];
    expect(detectFriendCobookings(rows)).toEqual([]);
  });
});
