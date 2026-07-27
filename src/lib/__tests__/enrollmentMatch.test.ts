import { describe, it, expect } from 'vitest';
import { matchEnrollments, MATCH_WINDOW_BEFORE_DAYS, MATCH_WINDOW_AFTER_DAYS } from '../enrollmentMatch';

const member = (id: number, kana: string, enrolled_at: string | null) => ({
  id,
  full_name_kana: kana,
  enrolled_at,
});
const trial = (
  id: number,
  kana: string | null,
  reserved_at: string,
  matched_by: string | null = null
) => ({ id, applicant_name_kana: kana, reserved_at, matched_by });

describe('matchEnrollments', () => {
  it('カナ一致かつ入会日が窓内なら突合する', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダ タロウ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-01')]
    );
    expect(r.matches).toEqual([{ trial_id: 1, member_id: 10 }]);
    expect(r.ambiguous).toEqual([]);
  });

  it('表記揺れ(ひらがな・中点・ヅ)を吸収する', () => {
    const r = matchEnrollments(
      [trial(1, 'やまだ・みづき', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダ ミズキ', '2026-06-03')]
    );
    expect(r.matches).toEqual([{ trial_id: 1, member_id: 10 }]);
  });

  it('入会が体験より前(窓外)なら突合しない', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-01-15')]
    );
    expect(r.matches).toEqual([]);
  });

  it('窓の内側の境界は突合する', () => {
    expect(MATCH_WINDOW_BEFORE_DAYS).toBe(7);
    expect(MATCH_WINDOW_AFTER_DAYS).toBe(90);
    const before = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-08 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-01')]
    );
    expect(before.matches).toHaveLength(1);
    const after = matchEnrollments(
      [trial(2, 'スズキハナコ', '2026-06-01 19:00:00')],
      [member(20, 'スズキハナコ', '2026-08-30')]
    );
    expect(after.matches).toHaveLength(1);
  });

  it('窓の外側の境界は突合しない', () => {
    const tooEarly = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-09 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-01')]
    );
    expect(tooEarly.matches).toEqual([]);
    const tooLate = matchEnrollments(
      [trial(2, 'スズキハナコ', '2026-06-01 19:00:00')],
      [member(20, 'スズキハナコ', '2026-08-31')]
    );
    expect(tooLate.matches).toEqual([]);
  });

  it('1つの体験に複数会員がヒットしたら確定させず ambiguous に入れる', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', '2026-06-02'), member(11, 'ヤマダタロウ', '2026-06-05')]
    );
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual([{ trial_id: 1, member_ids: [10, 11] }]);
  });

  it('同じ会員が複数の体験にヒットしたら最初の体験に寄せる', () => {
    const r = matchEnrollments(
      [
        trial(2, 'ヤマダタロウ', '2026-06-20 19:00:00'),
        trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00'),
      ],
      [member(10, 'ヤマダタロウ', '2026-06-25')]
    );
    expect(r.matches).toEqual([{ trial_id: 1, member_id: 10 }]);
  });

  it('手動で確定済み(matched_by=manual)の体験は触らない', () => {
    const r = matchEnrollments(
      [trial(1, 'ヤマダタロウ', '2026-06-01 19:00:00', 'manual')],
      [member(10, 'ヤマダタロウ', '2026-06-02')]
    );
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });

  it('カナが無い体験・入会日が無い会員は対象外', () => {
    const r = matchEnrollments(
      [trial(1, null, '2026-06-01 19:00:00'), trial(2, '   ', '2026-06-01 19:00:00')],
      [member(10, 'ヤマダタロウ', null)]
    );
    expect(r.matches).toEqual([]);
    expect(r.ambiguous).toEqual([]);
  });
});
