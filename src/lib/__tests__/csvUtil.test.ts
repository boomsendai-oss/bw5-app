import { describe, it, expect } from 'vitest';
import { parseDateTime } from '../csvUtil';

// parseDateTime の戻り値は 'YYYY-MM-DD' 前提の**文字列比較**で使われる
// (trialAttendance.resolveAttendance の day < todayJst 等)。
// ゼロ埋めされていない '2026-7-1' は '2026-07-27' より大きいと判定されるため、
// 正規化を関数側の責務として保証する。
describe('parseDateTime', () => {
  describe('ゼロ埋め正規化', () => {
    it('スラッシュ区切り・非ゼロ埋め (2026/7/1) をゼロ埋めISOにする', () => {
      expect(parseDateTime('2026/7/1')).toBe('2026-07-01');
    });

    it('ハイフン区切り・非ゼロ埋め (2026-7-1) もゼロ埋めする', () => {
      expect(parseDateTime('2026-7-1')).toBe('2026-07-01');
    });

    it('既にゼロ埋め済みの日付はそのまま返す(現行本番データの互換)', () => {
      expect(parseDateTime('2026-07-27')).toBe('2026-07-27');
    });

    it('時刻部分もゼロ埋めする (9:5:3 → 09:05:03)', () => {
      expect(parseDateTime('2026/7/1 9:5:3')).toBe('2026-07-01 09:05:03');
    });

    it('秒なしの時刻もゼロ埋めする (9:5 → 09:05)', () => {
      expect(parseDateTime('2026/7/1 9:5')).toBe('2026-07-01 09:05');
    });

    it('秒の有無は入力のまま保つ(既存レコードの重複判定キーを変えないため)', () => {
      // trial_records は (lstep_id, reserved_at) の完全一致で重複判定するので、
      // 秒を勝手に補うと既存行と別キーになり二重登録になる。
      expect(parseDateTime('2026-07-01 10:00')).toBe('2026-07-01 10:00');
      expect(parseDateTime('2026-07-01 10:00:00')).toBe('2026-07-01 10:00:00');
    });

    it('ISO の T 区切りは区切り文字を保ったまま正規化する', () => {
      expect(parseDateTime('2026-7-1T9:05')).toBe('2026-07-01T09:05');
    });

    it('前後の空白を除去する', () => {
      expect(parseDateTime('  2026/7/1 9:5:3  ')).toBe('2026-07-01 09:05:03');
    });

    it('日時の間に複数スペースがあっても1つに正規化する', () => {
      expect(parseDateTime('2026/7/1   09:05:03')).toBe('2026-07-01 09:05:03');
    });

    it('8桁数字 (YYYYMMDD) を ISO にする(parseDate と同じ扱い)', () => {
      expect(parseDateTime('20260701')).toBe('2026-07-01');
    });
  });

  describe('解釈できない入力は null (fail closed)', () => {
    it.each([
      ['空文字', ''],
      ['空白のみ', '   '],
      ['年のみの欠損値', '2026'],
      ['年月のみ', '2026-07'],
      ['日付でない文字列', 'なし'],
      ['月が範囲外', '2026-13-01'],
      ['月が0', '2026-00-01'],
      ['日が範囲外', '2026-07-32'],
      ['日が0', '2026-07-00'],
      ['時が範囲外', '2026-07-01 25:00'],
      ['分が範囲外', '2026-07-01 10:60'],
      ['秒が範囲外', '2026-07-01 10:00:60'],
      ['年が4桁でない', '26-07-01'],
      ['タイムゾーン付き(未対応形式)', '2026-07-01 10:00:00+09:00'],
      ['余分な後続文字', '2026-07-01 10:00:00 JST'],
    ])('%s → null', (_label, input) => {
      expect(parseDateTime(input)).toBeNull();
    });

    it('null / undefined は null', () => {
      expect(parseDateTime(null)).toBeNull();
      expect(parseDateTime(undefined)).toBeNull();
    });
  });

  describe('文字列比較が壊れないこと(本バグの再現)', () => {
    it('2026/7/1 の正規化結果は 2026-07-27 より小さい', () => {
      const day = (parseDateTime('2026/7/1') ?? '').slice(0, 10);
      // 修正前は '2026-7-1' が返り、'7' > '0' のためこの比較が false になっていた
      expect(day < '2026-07-27').toBe(true);
    });

    it('日付順の昇順ソートが暦順と一致する', () => {
      const days = ['2026/7/9', '2026/12/1', '2026/7/10', '2026/1/2']
        .map((s) => parseDateTime(s) as string)
        .sort();
      expect(days).toEqual(['2026-01-02', '2026-07-09', '2026-07-10', '2026-12-01']);
    });
  });
});
