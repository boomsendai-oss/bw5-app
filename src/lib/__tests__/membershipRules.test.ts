import { describe, it, expect, vi } from 'vitest';

// classifyWithdrawal / buildWithdrawalParams は純関数だが、モジュールが ./db を
// import しているためモックして完全に隔離する (他テストと同スタイル)。
vi.mock('../db', () => ({
  getOne: vi.fn(),
  getAll: vi.fn(),
  execute: vi.fn(),
}));

import {
  classifyWithdrawal,
  buildWithdrawalParams,
  isEnrollReliable,
  type ClassifyRow,
  type ClassifyParams,
} from '../membershipRules';

// ── ヘルパ ──

const params = (today: string, dataFloor: string | null = '2025-09-01'): ClassifyParams =>
  buildWithdrawalParams({
    today,
    normalMonths: 6,
    exceptionMonths: 3,
    reliableEnrollCutoff: '2025-09-01',
    noticeWindowDays: 30,
    dataFloor,
  });

const row = (over: Partial<ClassifyRow> = {}): ClassifyRow => ({
  checkin_count: 0,
  last_checkin: null,
  enrolled_at: null,
  extended_until: null,
  notice_status: null,
  family_active_link: null,
  member_created_at: null,
  ...over,
});

// today=2026-07-11 のとき: sixMonthsAgo=2026-01-11 / threeMonthsAgo=2026-04-11 / noticeLower=2026-02-10
const P = params('2026-07-11');

// ── buildWithdrawalParams (M8: 月末クランプ) ──

describe('buildWithdrawalParams', () => {
  it('通常日の基準日計算', () => {
    expect(P.sixMonthsAgo).toBe('2026-01-11');
    expect(P.threeMonthsAgo).toBe('2026-04-11');
    expect(P.noticeUpper).toBe('2026-01-11');
    expect(P.noticeLower).toBe('2026-02-10');
    expect(P.dataSpanOk).toBe(true);
  });

  it('M8: 8/31 の6ヶ月前は 2/28 にクランプ (旧実装は 3/3 に膨張し早すぎ候補化)', () => {
    const p = params('2026-08-31');
    expect(p.sixMonthsAgo).toBe('2026-02-28');
    expect(p.threeMonthsAgo).toBe('2026-05-31');
  });

  it('M8: 5/31 の3ヶ月前は 2/28 にクランプ', () => {
    expect(params('2026-05-31').threeMonthsAgo).toBe('2026-02-28');
  });

  it('M8: 閏年は 2/29 にクランプ', () => {
    expect(params('2028-08-31').sixMonthsAgo).toBe('2028-02-29');
  });

  it('dataFloor が無ければ dataSpanOk=false', () => {
    expect(params('2026-07-11', null).dataSpanOk).toBe(false);
  });

  it('dataFloor が6ヶ月以内なら dataSpanOk=false (観測期間不足)', () => {
    expect(params('2026-07-11', '2026-03-01').dataSpanOk).toBe(false);
  });
});

// ── classifyWithdrawal: 通常ルール(6ヶ月) ──

describe('classifyWithdrawal: inactive_6mo', () => {
  it('最終受講が6ヶ月超なら candidate', () => {
    const c = classifyWithdrawal(row({ checkin_count: 5, last_checkin: '2026-01-10' }), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'inactive_6mo' });
  });

  it('ちょうど6ヶ月(境界日)は candidate にならず事前通知帯', () => {
    const c = classifyWithdrawal(row({ checkin_count: 5, last_checkin: '2026-01-11' }), P);
    expect(c).toMatchObject({ bucket: 'pre_notice', reason: 'inactive_6mo' });
  });

  it('事前通知帯の上限手前(6ヶ月到達まで30日以内)は pre_notice', () => {
    const c = classifyWithdrawal(row({ checkin_count: 1, last_checkin: '2026-02-09' }), P);
    expect(c.bucket).toBe('pre_notice');
  });

  it('事前通知帯の外(まだ余裕がある)は none', () => {
    const c = classifyWithdrawal(row({ checkin_count: 1, last_checkin: '2026-02-10' }), P);
    expect(c.bucket).toBe('none');
  });

  it('last_checkin が datetime 形式でも日付部分で判定する', () => {
    const c = classifyWithdrawal(row({ checkin_count: 3, last_checkin: '2026-01-10 19:30:00' }), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'inactive_6mo' });
  });
});

// ── classifyWithdrawal: 入会3ヶ月例外 ──

describe('classifyWithdrawal: never_attended_3mo', () => {
  it('信頼できる入会日で3ヶ月超・0回受講なら candidate', () => {
    const c = classifyWithdrawal(row({ enrolled_at: '2025-10-01' }), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'never_attended_3mo' });
  });

  it('信頼できる入会日で3ヶ月以内なら none (様子見)', () => {
    const c = classifyWithdrawal(row({ enrolled_at: '2026-05-01' }), P);
    expect(c.bucket).toBe('none');
  });

  it('入会ちょうど3ヶ月(境界日)は none (< 厳密比較)', () => {
    const c = classifyWithdrawal(row({ enrolled_at: '2026-04-11' }), P);
    expect(c.bucket).toBe('none');
  });
});

// ── classifyWithdrawal: long_dormant_nodata (移行組) ──

describe('classifyWithdrawal: long_dormant_nodata', () => {
  it('移行クラスタ(信頼不可)の入会日・0回受講は観測事実で candidate', () => {
    const c = classifyWithdrawal(row({ enrolled_at: '2025-08-15' }), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'long_dormant_nodata' });
  });

  it('観測期間が6ヶ月未満(dataSpanOk=false)なら判定しない', () => {
    const c = classifyWithdrawal(row({ enrolled_at: '2025-08-15' }), params('2026-07-11', '2026-03-01'));
    expect(c.bucket).toBe('none');
  });
});

// ── M11(a): member_since による新規会員の保護 ──

describe('classifyWithdrawal: M11 member_since', () => {
  it('enrolled_at NULL でも created_at が新しければ nodata 候補にしない (新規保護)', () => {
    const c = classifyWithdrawal(row({ member_created_at: '2026-06-20 09:02:32' }), P);
    expect(c.bucket).toBe('none');
  });

  it('enrolled_at NULL で created_at が6ヶ月以上前なら nodata 候補', () => {
    const c = classifyWithdrawal(row({ member_created_at: '2025-10-01 00:00:00' }), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'long_dormant_nodata' });
  });

  it('enrolled_at も created_at も無ければ dataFloor を下限として判定 (従来互換)', () => {
    const c = classifyWithdrawal(row({}), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'long_dormant_nodata' });
  });

  it('member_since ちょうど6ヶ月前(境界日)は candidate (<= 比較)', () => {
    const c = classifyWithdrawal(row({ member_created_at: '2026-01-11 00:00:00' }), P);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'long_dormant_nodata' });
  });
});

// ── 家族アカウント保護 ──

describe('classifyWithdrawal: 家族保護', () => {
  it('candidate 相当でも現役家族リンクがあれば family_review へ', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', family_active_link: '山田 花子' }),
      P
    );
    expect(c).toMatchObject({ bucket: 'family_review', reason: 'inactive_6mo' });
  });

  it('nodata 候補も家族リンクがあれば family_review へ', () => {
    const c = classifyWithdrawal(row({ enrolled_at: '2025-08-15', family_active_link: '山田 花子' }), P);
    expect(c).toMatchObject({ bucket: 'family_review', reason: 'long_dormant_nodata' });
  });

  it('pre_notice は家族リンクがあっても pre_notice のまま (通知のみのため)', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-20', family_active_link: '山田 花子' }),
      P
    );
    expect(c.bucket).toBe('pre_notice');
  });
});

// ── 延長スキップ / 退会済みスキップ ──

describe('classifyWithdrawal: 延長・退会済み', () => {
  it('extended_until が未来なら判定スキップ (スタッフがタイマーリセット済み)', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', extended_until: '2026-12-31' }),
      P
    );
    expect(c.bucket).toBe('none');
  });

  it('extended_until が過去なら通常判定に戻る', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', extended_until: '2026-06-01' }),
      P
    );
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'inactive_6mo' });
  });

  it('extended_until が今日ちょうどなら延長は切れている (> 厳密比較)', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', extended_until: '2026-07-11' }),
      P
    );
    expect(c.bucket).toBe('candidate');
  });

  it('notice_status=withdrawn はスキップ', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', notice_status: 'withdrawn' }),
      P
    );
    expect(c.bucket).toBe('none');
  });
});

// ── M9読み側: extended_until の不正値防御 ──

describe('classifyWithdrawal: M9 不正な extended_until', () => {
  it("スラッシュ形式 '2026/08/01' は延長無効 + warning (旧実装は辞書順で「未来」と誤解釈し候補を隠していた)", () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', extended_until: '2026/08/01' }),
      P
    );
    expect(c.bucket).toBe('candidate'); // 延長扱いにしない
    expect(c.warnings).toHaveLength(1);
    expect(c.warnings[0]).toContain('2026/08/01');
  });

  it("実在しない日付 '2026-02-30' も延長無効 + warning", () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-01-10', extended_until: '2026-02-30' }),
      P
    );
    expect(c.bucket).toBe('candidate');
    expect(c.warnings).toHaveLength(1);
  });

  it('不正値でも最終的に none になるケースで warning は残る', () => {
    const c = classifyWithdrawal(
      row({ checkin_count: 5, last_checkin: '2026-07-01', extended_until: 'invalid' }),
      P
    );
    expect(c.bucket).toBe('none');
    expect(c.warnings).toHaveLength(1);
  });
});

// ── M8: クランプが判定に効くこと (安全方向=候補が減る) ──

describe('classifyWithdrawal: M8 クランプの実効', () => {
  it('8/31基準: 最終受講 3/1 は旧実装(6ヶ月前=3/3)なら candidate だったが、クランプ後(2/28)は pre_notice', () => {
    const p = params('2026-08-31');
    const c = classifyWithdrawal(row({ checkin_count: 5, last_checkin: '2026-03-01' }), p);
    expect(c.bucket).toBe('pre_notice'); // candidate ではない = 早すぎ候補化の解消
  });

  it('8/31基準: 最終受講 2/27 はクランプ後も candidate (正しく6ヶ月超)', () => {
    const p = params('2026-08-31');
    const c = classifyWithdrawal(row({ checkin_count: 5, last_checkin: '2026-02-27' }), p);
    expect(c).toMatchObject({ bucket: 'candidate', reason: 'inactive_6mo' });
  });
});

// ── isEnrollReliable ──

describe('isEnrollReliable', () => {
  it('移行クラスタ以後は信頼できる', () => {
    expect(isEnrollReliable('2025-09-01', '2025-09-01')).toBe(true);
    expect(isEnrollReliable('2026-05-01 00:00:00', '2025-09-01')).toBe(true);
  });
  it('移行クラスタ(2025-08)以前・NULL は信頼できない', () => {
    expect(isEnrollReliable('2025-08-15', '2025-09-01')).toBe(false);
    expect(isEnrollReliable(null, '2025-09-01')).toBe(false);
  });
});
