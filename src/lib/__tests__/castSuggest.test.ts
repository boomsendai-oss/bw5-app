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

describe('pickLessonForShot — 講師で絞る(TARO 2026-09-08の実害)', () => {
  // 8/30の実データ: SAYUKI FREE STYLE(14:00-15:30) と ベーシック(15:00-16:00) が重なる
  const day = [
    { start: '14:00', end: '15:30', program: 'SAYUKI / FREE STYLE', staff: 'SAYUKI' },
    { start: '15:00', end: '16:00', program: 'ベーシックダンスクラス', staff: 'KEIKO' },
  ];

  it('講師を渡さないと開始が近いベーシックを選んでしまう(修正前の挙動)', () => {
    expect(pickLessonForShot(day, '15:33')?.program).toBe('ベーシックダンスクラス');
  });

  it('講師SAYUKIを渡すとFREE STYLEを選ぶ', () => {
    expect(pickLessonForShot(day, '15:33', 'SAYUKI')?.program).toBe('SAYUKI / FREE STYLE');
  });

  it('講師KEIKOを渡すとベーシックを選ぶ', () => {
    expect(pickLessonForShot(day, '15:33', 'KEIKO')?.program).toBe('ベーシックダンスクラス');
  });

  it('講師名の表記ゆれ(全角/小文字/空白)を吸収する', () => {
    expect(pickLessonForShot(day, '15:33', ' sayuki ')?.program).toBe('SAYUKI / FREE STYLE');
    expect(pickLessonForShot(day, '15:33', 'ＳＡＹＵＫＩ')?.program).toBe('SAYUKI / FREE STYLE');
  });

  it('その講師のレッスンが無い日は従来どおり時刻で選ぶ(空振りで候補ゼロにしない)', () => {
    expect(pickLessonForShot(day, '15:33', 'AOI')?.program).toBe('ベーシックダンスクラス');
  });

  it('「K@TTSU / AOI」のような連名でも部分一致で拾う', () => {
    const d2 = [
      { start: '11:00', end: '12:30', program: '多賀城 HOUSE', staff: 'K@TTSU' },
      { start: '11:00', end: '12:00', program: '初めてのヒップホップ', staff: 'KEIKO' },
    ];
    expect(pickLessonForShot(d2, '12:10', 'K@TTSU / AOI')?.program).toBe('多賀城 HOUSE');
  });
});

describe('pickLessonForShot: 講師が2人のクラス(2026-10-21の実害)', () => {
  const S = (start: string, end: string, program: string, staff: string) => ({ start, end, program, staff });
  // 10/8 19:00 は同時刻に2クラス。長町WSの動画(講師欄「TARO & KOKEKO」)に
  // Ryukiのクラスの受講者が出ていた。HACOMONO側の表記は「KOKEKO | TARO」。
  const day = [
    S('18:00', '19:00', '長町 HIPHOP 入門', 'KOKEKO | TARO'),
    S('19:00', '20:30', 'Ryuki HIPHOP 初級', 'Ryuki'),
    S('19:00', '20:30', '長町 HIPHOP 初級', 'KOKEKO | TARO'),
  ];

  it('並びも区切りも違う2人講師の表記を同じ人たちと判定する', () => {
    expect(pickLessonForShot(day, '20:30', 'TARO & KOKEKO')?.program).toBe('長町 HIPHOP 初級');
  });

  it('講師1人の指定でも、2人担当のクラスに当たる', () => {
    expect(pickLessonForShot(day, '20:30', 'KOKEKO')?.program).toBe('長町 HIPHOP 初級');
  });

  it('別の講師なら今まで通りその講師のクラス', () => {
    expect(pickLessonForShot(day, '20:30', 'Ryuki')?.program).toBe('Ryuki HIPHOP 初級');
  });
});
