import { describe, it, expect } from 'vitest';
import {
  toHiragana,
  cleanLessonName,
  formatDateLabel,
  buildVisitorBlock,
  buildTrialGroups,
  type TrialRow,
  type TrialVisitor,
} from '../trialNotify';

describe('toHiragana', () => {
  it('カタカナをひらがなに変換する', () => {
    expect(toHiragana('ヤマダハナ')).toBe('やまだはな');
    expect(toHiragana('ソウタ')).toBe('そうた');
  });
  it('長音符・ひらがな・記号はそのまま', () => {
    expect(toHiragana('リョウカ')).toBe('りょうか');
    expect(toHiragana('ケンイチロー')).toBe('けんいちろー');
    expect(toHiragana('やまだ')).toBe('やまだ');
  });
});

describe('cleanLessonName', () => {
  it('装飾・曜日・時刻の接頭辞を落として実クラス名を取り出す', () => {
    expect(cleanLessonName('?(土) 16:30～ 長町 キッズガールズ 入門')).toBe('長町 キッズガールズ 入門');
    expect(cleanLessonName('大人メンバー募集中???(日) 15:00～ ベーシッククラス')).toBe('ベーシッククラス');
    expect(cleanLessonName('リニューアル?? (日) 11:00～ はじめてのヒップホップ (キッズ向け)')).toBe('はじめてのヒップホップ (キッズ向け)');
    expect(cleanLessonName('(水) 20:00～ K@TTSU HOUSE')).toBe('K@TTSU HOUSE');
  });
  it('時刻が無ければ先頭の装飾だけ落とす / 空はプレースホルダ', () => {
    expect(cleanLessonName('・特別クラス')).toBe('特別クラス');
    expect(cleanLessonName('')).toBe('（枠未指定）');
    expect(cleanLessonName(null)).toBe('（枠未指定）');
  });
});

describe('formatDateLabel', () => {
  it('曜日つきの日付ラベルを作る', () => {
    expect(formatDateLabel('2026-07-18')).toBe('7/18(土)');
    expect(formatDateLabel('2026-07-17')).toBe('7/17(金)');
  });
});

describe('buildVisitorBlock', () => {
  const v = (o: Partial<TrialVisitor>): TrialVisitor => ({
    name: 'はな', age: 8, course: '体験レッスン', experience: '未経験', referral: 'インスタ', isObservation: false, ...o,
  });
  it('名前(年齢)＋詳細の2行', () => {
    expect(buildVisitorBlock(v({}))).toBe('・はな（8歳）\n　経験:未経験／きっかけ:インスタ');
  });
  it('見学は【見学】を付ける', () => {
    expect(buildVisitorBlock(v({ isObservation: true }))).toBe('・はな（8歳）【見学】\n　経験:未経験／きっかけ:インスタ');
  });
  it('経験・きっかけが無ければ2行目を省略', () => {
    expect(buildVisitorBlock(v({ experience: null, referral: null }))).toBe('・はな（8歳）');
  });
  it('年齢が無ければ（歳）を省略', () => {
    expect(buildVisitorBlock(v({ age: null, referral: null }))).toBe('・はな\n　経験:未経験');
  });
});

describe('buildTrialGroups', () => {
  const base: TrialRow = {
    reserved_at: '2026-07-18 18:30:00',
    lesson_name: '?(土) 18:30～ TARO HIPHOP 初級',
    status: '予約済',
    applicant_name: '山田花',
    applicant_name_kana: 'ヤマダハナ',
    applicant_age: 8,
    course_type: '体験レッスン',
    dance_experience: '未経験',
    referral_source: 'インスタ',
  };

  it('日付×レッスンでまとめ、ゆったり形式のコピーテキストを組み立てる', () => {
    const groups = buildTrialGroups([
      base,
      { ...base, applicant_name_kana: 'サトウソウタ', applicant_age: 10, dance_experience: '経験者', referral_source: '紹介' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lessonName).toBe('TARO HIPHOP 初級');
    expect(groups[0].copyText).toBe(
      [
        '【体験のお知らせ】7/18(土) 18:30〜',
        'TARO HIPHOP 初級',
        '',
        '・やまだはな（8歳）',
        '　経験:未経験／きっかけ:インスタ',
        '',
        '・さとうそうた（10歳）',
        '　経験:経験者／きっかけ:紹介',
      ].join('\n'),
    );
  });

  it('キャンセル・ノーショーは除外する', () => {
    const groups = buildTrialGroups([
      { ...base, status: 'キャンセル' },
      { ...base, status: 'ノーショー' },
    ]);
    expect(groups).toHaveLength(0);
  });

  it('装飾違いでも同じ実クラス名なら同一グループにまとまる', () => {
    const groups = buildTrialGroups([
      { ...base, reserved_at: '2026-07-19 15:00:00', lesson_name: '大人募集中(日) 15:00～ ベーシッククラス' },
      { ...base, reserved_at: '2026-07-19 15:00:00', lesson_name: '?(日) 15:00～ ベーシッククラス', applicant_name_kana: 'スズキミク' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].lessonName).toBe('ベーシッククラス');
    expect(groups[0].visitors).toHaveLength(2);
  });

  it('見学は【見学】付きで出る', () => {
    const groups = buildTrialGroups([{ ...base, course_type: '見学' }]);
    expect(groups[0].copyText).toContain('【見学】');
  });

  it('カナが無ければ漢字名にフォールバック', () => {
    const groups = buildTrialGroups([{ ...base, applicant_name_kana: null, applicant_name: '山田花' }]);
    expect(groups[0].visitors[0].name).toBe('山田花');
  });
});
