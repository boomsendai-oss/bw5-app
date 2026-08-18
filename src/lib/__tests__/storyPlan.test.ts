import { describe, expect, it } from 'vitest';
import { matchDeclaredLesson } from '../storyPlan';

// instructors テーブルの登録名(UPPERCASE比較される)
const KNOWN = ['K@TTSU', 'AOI', 'TARO', 'KEIKO', 'RYUKI', 'ちゃんなつ', 'SAYUKI', 'おっちゃん', 'HARUKA', 'YURI', 'KOKEKO', 'MY'];
const ev = (start: string, summary: string) => ({ start, summary });

describe('matchDeclaredLesson (台帳の宣言レッスンが当日カレンダーに実在するか)', () => {
  it('宣言と同じ時刻・同じ講師のレッスンがあれば一致', () => {
    const cal = [ev('11:00', '【AOI】多賀城 HIPHOP 初級')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'AOI' })).toBe(true);
  });

  it('講師名がタイトル末尾でも一致(【】の位置に依存しない)', () => {
    const cal = [ev('12:45', '多賀城  HIPHOP基礎クラス【AOI】🔰')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '12:45', instructor: 'AOI' })).toBe(true);
  });

  it('同時刻でも講師が違えば不一致', () => {
    const cal = [ev('11:00', '【AOI】多賀城 HIPHOP 初級')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'K@TTSU' })).toBe(false);
  });

  it('全角＠で書かれた講師名でも一致する(NFKC正規化)', () => {
    // 実例: 2026-09-12 の「多賀城HOUSE【K＠TTSU】」。全角のまま比較すると講師名なし扱いになり素材が出なかった
    const cal = [ev('11:00', '多賀城HOUSE【K＠TTSU】')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'K@TTSU' })).toBe(true);
  });

  it('全角英字で書かれた講師名でも一致する(NFKC正規化)', () => {
    const cal = [ev('18:30', '【ＫＥＩＫＯ】多賀城 JAZZ')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '18:30', instructor: 'KEIKO' })).toBe(true);
  });

  it('全角で正規化しても別の講師には一致しない', () => {
    const cal = [ev('11:00', '多賀城HOUSE【K＠TTSU】')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'AOI' })).toBe(false);
  });

  it('同時刻に複数レッスンがあれば、その中の一致で判定する', () => {
    const cal = [ev('11:00', '【 KEIKO】キッズ はじめてのHIPHOP🔰'), ev('11:00', '【AOI】多賀城 HIPHOP 初級')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'AOI' })).toBe(true);
  });

  it('代講表記があれば代講に入る講師で一致する', () => {
    const cal = [ev('11:00', '【TARO】キッズHIPHOP 代講 KOKEKO')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'KOKEKO' })).toBe(true);
  });

  it('宣言時刻にカレンダー予定が無ければ不一致', () => {
    const cal = [ev('15:30', '【YURI】長町WAACK 初級')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'AOI' })).toBe(false);
  });

  // ★2026-08-08の誤配信の再現。
  // 当日カレンダーの11:00は「⚔️ダンスバトル練習会」(レッスンではない/講師名なし)だけだったのに、
  // 「時刻が一致し、タイトルに講師名が無ければ一致とみなす」規則により
  // 多賀城AOI・多賀城KATTSUの2枚が「カレンダーに実在する」と誤判定され自動投稿された。
  it('講師名の無い非レッスン予定は、時刻が同じでも一致とみなさない', () => {
    const cal = [ev('11:00', '⚔️ダンスバトル練習会')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'AOI' })).toBe(false);
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'K@TTSU' })).toBe(false);
  });

  it('講師名の無い予定と本物のレッスンが同時刻に並んでも、本物の方で正しく判定する', () => {
    const cal = [ev('11:00', '⚔️ダンスバトル練習会'), ev('11:00', '【AOI】多賀城 HIPHOP 初級')];
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'AOI' })).toBe(true);
    expect(matchDeclaredLesson(cal, KNOWN, { start: '11:00', instructor: 'K@TTSU' })).toBe(false);
  });
});
