import { describe, expect, it } from 'vitest';
import { pickLessonForShot, normalizeIgHandle } from '../castSuggest';

const L = (start: string, end: string | null, program: string) => ({ start, end, program });

describe('pickLessonForShot (撮影時刻→どのレッスンの動画か)', () => {
  it('レッスン中の撮影はそのレッスン', () => {
    const got = pickLessonForShot([L('11:00', '12:00', 'HOUSE'), L('15:30', '16:30', 'WAACK')], '11:30');
    expect(got?.program).toBe('HOUSE');
  });

  it('終了後45分以内(片付け中の撮影)もそのレッスン扱い — 3/21 HOUSEの実例(12:21撮影)', () => {
    const got = pickLessonForShot(
      [L('11:00', '12:00', '多賀城 HOUSE'), L('15:30', '16:30', 'WAACK'), L('16:30', '17:30', 'キッズ')],
      '12:21'
    );
    expect(got?.program).toBe('多賀城 HOUSE');
  });

  it('どの窓にも入らない時刻は開始が一番近いレッスン', () => {
    const got = pickLessonForShot([L('11:00', '12:00', 'A'), L('15:30', '16:30', 'B')], '14:50');
    expect(got?.program).toBe('B');
  });

  it('終了時刻不明は開始+90分とみなす', () => {
    const got = pickLessonForShot([L('19:00', null, '夜クラス')], '20:50');
    expect(got?.program).toBe('夜クラス');
  });

  it('空なら null', () => {
    expect(pickLessonForShot([], '12:00')).toBeNull();
  });
});

describe('normalizeIgHandle', () => {
  it('@と空白を落とす', () => expect(normalizeIgHandle(' @k_umi ')).toBe('k_umi'));
  it('日本語などの不正はnull', () => expect(normalizeIgHandle('うみ')).toBeNull());
  it('空はnull', () => expect(normalizeIgHandle('')).toBeNull());
});
