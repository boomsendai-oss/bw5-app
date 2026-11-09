import { describe, it, expect } from 'vitest';
import { buildTrialGroups, type TrialRow } from '../trialNotify';
import { addMinutes, findLessonSlot, buildTrialCalendarEvents, type LessonSlot } from '../trialCalendarEvents';

const row = (o: Partial<TrialRow>): TrialRow => ({
  reserved_at: '2026-11-14 16:30:00', lesson_name: '(土) 16:30～ 長町 ガールズ 入門', status: '予約済',
  applicant_name: '山田 花子', applicant_name_kana: 'ヤマダ ハナコ', applicant_age: 20,
  course_type: '体験レッスン', dance_experience: 'なし', referral_source: 'Instagram', ...o,
});
const slots: LessonSlot[] = [
  { date: '2026-11-14', start: '16:30', end: '17:30', summary: '【KEIKO】長町ガールズ 入門', location: 'コナミスポーツ長町' },
  { date: '2026-11-15', start: '11:00', end: '12:00', summary: '【K@TTSU】多賀城 HIPHOP初級', location: '多賀城' },
  { date: '2026-11-15', start: '11:00', end: '11:45', summary: '【MYU】キッズ初めてのヒップホップ', location: 'GOAT' },
];

describe('addMinutes', () => {
  it('60分足す', () => expect(addMinutes('16:30', 60)).toBe('17:30'));
  it('日付をまたがない', () => expect(addMinutes('23:30', 60)).toBe('23:59'));
});

describe('findLessonSlot', () => {
  it('同じ時刻が1件ならそれ', () => expect(findLessonSlot('2026-11-14', '16:30', 'x', slots)?.end).toBe('17:30'));
  it('同じ時刻が複数なら名前が近い方', () =>
    expect(findLessonSlot('2026-11-15', '11:00', 'キッズ初めてのヒップホップ', slots)?.location).toBe('GOAT'));
  it('無ければnull', () => expect(findLessonSlot('2026-11-16', '11:00', 'x', slots)).toBeNull());
});

describe('buildTrialCalendarEvents', () => {
  it('体験と見学の人数・終了時刻・場所が入る', () => {
    const g = buildTrialGroups([row({}), row({ applicant_name_kana: 'サトウ ミキ', course_type: '見学' })]);
    const [ev] = buildTrialCalendarEvents(g, slots);
    expect(ev.summary).toBe('🔰体験1名・見学1名｜長町 ガールズ 入門');
    expect(ev.start).toBe('16:30');
    expect(ev.end).toBe('17:30');
    expect(ev.location).toBe('コナミスポーツ長町');
    expect(ev.description).toContain('やまだ はなこ（20歳）');
    expect(ev.key).toBe('2026-11-14|長町 ガールズ 入門');
  });
  it('キャンセルだけの枠は予定にしない', () => {
    expect(buildTrialCalendarEvents(buildTrialGroups([row({ status: 'キャンセル' })]), slots)).toHaveLength(0);
  });
  it('正本に無いレッスンは60分・場所なし', () => {
    const [ev] = buildTrialCalendarEvents(buildTrialGroups([row({ reserved_at: '2026-11-20 18:00:00' })]), slots);
    expect(ev.end).toBe('19:00');
    expect(ev.location).toBeNull();
  });
  it('中身が変わると指紋も変わる', () => {
    const a = buildTrialCalendarEvents(buildTrialGroups([row({})]), slots)[0].hash;
    const b = buildTrialCalendarEvents(buildTrialGroups([row({}), row({ applicant_name_kana: 'サトウ' })]), slots)[0].hash;
    expect(a).not.toBe(b);
  });
});
