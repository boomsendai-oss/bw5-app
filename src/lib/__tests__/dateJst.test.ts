import { describe, it, expect } from 'vitest';
import {
  todayJst, nowUtcIso, weekdayJst, shiftMonthsClamped, shiftDays, isIsoDate, isYearMonth, isHhmm,
} from '../dateJst';

describe('todayJst', () => {
  it('JST基準で日付を返す(UTC 23:59 = JST翌日08:59)', () => {
    expect(todayJst(new Date('2026-07-06T23:59:00Z'))).toBe('2026-07-07');
  });
  it('UTC 15:00 = JST翌日00:00 で日付が繰り上がる', () => {
    expect(todayJst(new Date('2026-07-06T15:00:00Z'))).toBe('2026-07-07');
  });
  it('UTC 14:59 = JST 23:59 は同日', () => {
    expect(todayJst(new Date('2026-07-06T14:59:00Z'))).toBe('2026-07-06');
  });
});

describe('nowUtcIso', () => {
  it('UTC ISO(Z付き)を返す', () => {
    expect(nowUtcIso(new Date('2026-07-06T12:00:00Z'))).toBe('2026-07-06T12:00:00.000Z');
  });
});

describe('weekdayJst', () => {
  // 2026-07-16 は木曜(4)。旧 `new Date('...T00:00:00+09:00').getDay()` は
  // サーバーUTCだと前日(水=3)を返す1日ズレの温床だった(実際にcronが wed.mp4 を探した)。
  it('文字列の曜日を正しく返す(木曜=4)', () => {
    expect(weekdayJst('2026-07-16')).toBe(4);
  });
  it('日曜=0 / 土曜=6 の両端', () => {
    expect(weekdayJst('2026-07-19')).toBe(0); // 日
    expect(weekdayJst('2026-07-18')).toBe(6); // 土
  });
  it('Dateを渡すとJST日付の曜日(UTC 15:00=JST翌日00:00で曜日も繰り上がる)', () => {
    // UTC 2026-07-15T15:00 = JST 2026-07-16T00:00 → 木曜
    expect(weekdayJst(new Date('2026-07-15T15:00:00Z'))).toBe(4);
    // UTC 2026-07-15T14:59 = JST 2026-07-15T23:59 → 水曜
    expect(weekdayJst(new Date('2026-07-15T14:59:00Z'))).toBe(3);
  });
});

describe('shiftMonthsClamped', () => {
  it('1/31 +1M → 2/28 (ロールオーバーしない)', () => {
    expect(shiftMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
  });
  it('8/31 +6M → 2/28 (旧ロールオーバー実装は3/3)', () => {
    expect(shiftMonthsClamped('2026-08-31', 6)).toBe('2027-02-28');
  });
  it('通常日は素直にシフト', () => {
    expect(shiftMonthsClamped('2026-03-15', 2)).toBe('2026-05-15');
  });
  it('年跨ぎ・負のシフト', () => {
    expect(shiftMonthsClamped('2026-01-15', -2)).toBe('2025-11-15');
  });
  it('うるう年 2/29 が絡む (2024-02-29 +12M → 2025-02-28)', () => {
    expect(shiftMonthsClamped('2024-02-29', 12)).toBe('2025-02-28');
  });
});

describe('shiftDays', () => {
  it('月跨ぎ +5日', () => {
    expect(shiftDays('2026-06-29', 5)).toBe('2026-07-04');
  });
  it('負のシフトで前月へ', () => {
    expect(shiftDays('2026-07-01', -1)).toBe('2026-06-30');
  });
});

describe('isIsoDate', () => {
  it('正当な日付', () => {
    expect(isIsoDate('2026-08-01')).toBe(true);
  });
  it('実在しない日付を拒否 (2026-02-30)', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
  });
  it('ゼロ詰めなしを拒否 (2026-7-5)', () => {
    expect(isIsoDate('2026-7-5')).toBe(false);
  });
  it('スラッシュ区切りを拒否 (2026/08/01)', () => {
    expect(isIsoDate('2026/08/01')).toBe(false);
  });
  it('非文字列を拒否', () => {
    expect(isIsoDate(20260801)).toBe(false);
    expect(isIsoDate(null)).toBe(false);
  });
});

describe('isYearMonth', () => {
  it('正当な年月', () => { expect(isYearMonth('2026-07')).toBe(true); });
  it('月13を拒否', () => { expect(isYearMonth('2026-13')).toBe(false); });
  it('日付付きを拒否', () => { expect(isYearMonth('2026-07-01')).toBe(false); });
});

describe('isHhmm', () => {
  it('HH:MM', () => { expect(isHhmm('19:30')).toBe(true); });
  it('HH:MM:SS', () => { expect(isHhmm('19:30:00')).toBe(true); });
  it('24時を拒否', () => { expect(isHhmm('24:00')).toBe(false); });
  it('分60を拒否', () => { expect(isHhmm('19:60')).toBe(false); });
});
