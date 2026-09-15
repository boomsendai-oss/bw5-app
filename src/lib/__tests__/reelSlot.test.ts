import { describe, it, expect } from 'vitest';
import { nextReelSlot, nextReelSlotIso, nextReelSlotLocal, reelSlotDow } from '../reelSlot';

/** JSTの日時から Date を作る(テストの意図を読みやすくするためのヘルパー) */
const jst = (s: string) => new Date(`${s}+09:00`);
/** 判定結果をJSTの 'YYYY-MM-DD HH:MM' で読む */
const asJst = (d: Date | null) =>
  d === null ? null : new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');

describe('reelSlotDow', () => {
  it('発表会は金(5)・クラスは火(2)', () => {
    expect(reelSlotDow('発表会')).toBe(5);
    expect(reelSlotDow('stage')).toBe(5);
    expect(reelSlotDow('class')).toBe(2);
    expect(reelSlotDow(undefined)).toBe(2);
  });
});

describe('nextReelSlot(クラス=火曜19時)', () => {
  // 2026-09-15 は火曜。この日の挙動が今回の事故そのもの
  // (TARO 2026-09-15: 火曜の昼に予約したら翌週9/22に入った)。
  it('火曜の昼に予約したら「その日の19時」', () => {
    expect(asJst(nextReelSlot('class', jst('2026-09-15T16:30')))).toBe('2026-09-15 19:00');
  });

  it('火曜の18:59はまだ間に合う＝当日', () => {
    expect(asJst(nextReelSlot('class', jst('2026-09-15T18:59')))).toBe('2026-09-15 19:00');
  });

  it('火曜の19:00ちょうどを過ぎたら翌週', () => {
    expect(asJst(nextReelSlot('class', jst('2026-09-15T19:00')))).toBe('2026-09-22 19:00');
    expect(asJst(nextReelSlot('class', jst('2026-09-15T23:30')))).toBe('2026-09-22 19:00');
  });

  it('火曜以外はその週の次の火曜', () => {
    expect(asJst(nextReelSlot('class', jst('2026-09-16T09:00')))).toBe('2026-09-22 19:00'); // 水
    expect(asJst(nextReelSlot('class', jst('2026-09-14T09:00')))).toBe('2026-09-15 19:00'); // 月
  });

  it('JSTの深夜(UTCでは前日)でも日付がずれない', () => {
    expect(asJst(nextReelSlot('class', jst('2026-09-15T00:30')))).toBe('2026-09-15 19:00');
  });
});

describe('nextReelSlot(発表会=金曜19時)', () => {
  it('金曜の昼なら当日・19時を過ぎたら翌週', () => {
    expect(asJst(nextReelSlot('発表会', jst('2026-09-18T12:00')))).toBe('2026-09-18 19:00');
    expect(asJst(nextReelSlot('stage', jst('2026-09-18T20:00')))).toBe('2026-09-25 19:00');
  });

  it('クラスが金曜に、発表会が火曜に出ない', () => {
    expect(asJst(nextReelSlot('class', jst('2026-09-18T12:00')))).toBe('2026-09-22 19:00');
    expect(asJst(nextReelSlot('stage', jst('2026-09-15T12:00')))).toBe('2026-09-18 19:00');
  });
});

describe('画面とAPIが同じ枠を指す', () => {
  // 画面のボタン表示(local)とAPIに送るISOが食い違うと「押した日と違う日」に入る。
  it('nextReelSlotLocal と nextReelSlotIso が同じ時刻を表す', () => {
    for (const now of ['2026-09-15T16:30', '2026-09-15T19:30', '2026-09-18T10:00', '2026-09-13T08:00']) {
      const iso = nextReelSlotIso('class', jst(now));
      const local = nextReelSlotLocal('class', jst(now));
      expect(new Date(`${local}:00+09:00`).toISOString()).toBe(iso);
    }
  });

  it('datetime-local の書式で返る', () => {
    expect(nextReelSlotLocal('class', jst('2026-09-15T16:30'))).toBe('2026-09-15T19:00');
  });
});
