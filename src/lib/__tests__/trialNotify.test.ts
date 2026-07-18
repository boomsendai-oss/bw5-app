import { describe, it, expect } from 'vitest';
import {
  toHiragana,
  formatDateLabel,
  buildVisitorLine,
  buildTrialGroups,
  type TrialRow,
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

describe('formatDateLabel', () => {
  it('曜日つきの日付ラベルを作る', () => {
    expect(formatDateLabel('2026-07-18')).toBe('7/18(土)');
    expect(formatDateLabel('2026-07-17')).toBe('7/17(金)');
  });
});

describe('buildVisitorLine', () => {
  it('全項目そろっている行', () => {
    expect(
      buildVisitorLine({ name: 'はな', age: 8, course: '体験レッスン', experience: '未経験', referral: 'インスタグラム' }),
    ).toBe('・はな（8歳）／体験レッスン／未経験／きっかけ: インスタグラム');
  });
  it('欠損項目は省略する', () => {
    expect(buildVisitorLine({ name: 'そうた', age: null, course: null, experience: null, referral: null })).toBe('・そうた');
    expect(
      buildVisitorLine({ name: 'みく', age: 10, course: '見学', experience: null, referral: null }),
    ).toBe('・みく（10歳）／見学');
  });
});

describe('buildTrialGroups', () => {
  const base: TrialRow = {
    reserved_at: '2026-07-18 18:30:00',
    lesson_name: 'AOI 七ヶ浜 入門',
    status: '予約済',
    applicant_name: '山田花',
    applicant_name_kana: 'ヤマダハナ',
    applicant_age: 8,
    course_type: '体験レッスン',
    dance_experience: '未経験',
    referral_source: 'インスタグラム',
  };

  it('日付×レッスンでまとめ、コピーテキストを組み立てる', () => {
    const groups = buildTrialGroups([
      base,
      { ...base, applicant_name: '佐藤颯', applicant_name_kana: 'サトウソウタ', applicant_age: 10, dance_experience: '経験者', referral_source: '知り合いからのご紹介' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].visitors).toHaveLength(2);
    expect(groups[0].copyText).toBe(
      [
        '【体験のお知らせ】7/18(土) 18:30〜',
        'AOI 七ヶ浜 入門',
        '──────────',
        '・やまだはな（8歳）／体験レッスン／未経験／きっかけ: インスタグラム',
        '・さとうそうた（10歳）／体験レッスン／経験者／きっかけ: 知り合いからのご紹介',
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

  it('別の枠は別グループになる', () => {
    const groups = buildTrialGroups([
      base,
      { ...base, reserved_at: '2026-07-19 15:00:00', lesson_name: 'ベーシッククラス' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.lessonName)).toEqual(['AOI 七ヶ浜 入門', 'ベーシッククラス']);
  });

  it('カナが無ければ漢字名にフォールバック', () => {
    const groups = buildTrialGroups([{ ...base, applicant_name_kana: null, applicant_name: '山田花' }]);
    expect(groups[0].visitors[0].name).toBe('山田花');
  });
});
