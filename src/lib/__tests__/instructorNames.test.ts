import { describe, it, expect } from 'vitest';
import { splitInstructorNames, resolveInstructorHandles } from '../instructorNames';

// 実データの登録簿(抜粋)
const TABLE = [
  { name: 'AOI', handle: 'aoi.w_0530' },
  { name: 'K@TTSU', handle: 'kattsu_ziel' },
  { name: 'KEIKO', handle: 'm55keiko' },
  { name: 'Ryuki', handle: 'takaryu_1203' },
  { name: 'TARO', handle: 'taro_bsb' },
  { name: 'NONOKA', handle: null }, // ハンドル未登録の講師
];

describe('splitInstructorNames', () => {
  it('1人ならそのまま', () => {
    expect(splitInstructorNames('K@TTSU')).toEqual(['K@TTSU']);
  });

  it('スラッシュ区切り(多賀城HOUSE)', () => {
    expect(splitInstructorNames('K@TTSU / AOI')).toEqual(['K@TTSU', 'AOI']);
  });

  it('アンパサンド区切り(GRAFFITI)', () => {
    expect(splitInstructorNames('TARO & Ryuki')).toEqual(['TARO', 'Ryuki']);
  });

  it('全角の区切りも読む', () => {
    expect(splitInstructorNames('TARO／Ryuki')).toEqual(['TARO', 'Ryuki']);
    expect(splitInstructorNames('TARO＆Ryuki')).toEqual(['TARO', 'Ryuki']);
    expect(splitInstructorNames('TARO、Ryuki')).toEqual(['TARO', 'Ryuki']);
  });

  it('講師名の@を区切りにしない(K@TTSUが割れない)', () => {
    expect(splitInstructorNames('K@TTSU')).toEqual(['K@TTSU']);
    expect(splitInstructorNames('K@TTSU & AOI')).toEqual(['K@TTSU', 'AOI']);
  });

  it('空・null は空配列', () => {
    expect(splitInstructorNames(null)).toEqual([]);
    expect(splitInstructorNames('   ')).toEqual([]);
  });
});

describe('resolveInstructorHandles', () => {
  it('2人分のハンドルを解決する(今回の多賀城HOUSE)', () => {
    expect(resolveInstructorHandles('K@TTSU / AOI', TABLE)).toEqual([
      { name: 'K@TTSU', handle: 'kattsu_ziel' },
      { name: 'AOI', handle: 'aoi.w_0530' },
    ]);
  });

  it('GRAFFITIの2人も解決する', () => {
    expect(resolveInstructorHandles('TARO & Ryuki', TABLE)).toEqual([
      { name: 'TARO', handle: 'taro_bsb' },
      { name: 'Ryuki', handle: 'takaryu_1203' },
    ]);
  });

  it('大文字小文字を問わない', () => {
    expect(resolveInstructorHandles('ryuki', TABLE)).toEqual([{ name: 'ryuki', handle: 'takaryu_1203' }]);
  });

  it('ハンドル未登録の講師は handle:null で残す(画面で理由を出すため)', () => {
    expect(resolveInstructorHandles('NONOKA', TABLE)).toEqual([{ name: 'NONOKA', handle: null }]);
  });

  it('登録簿に無い講師も残す', () => {
    expect(resolveInstructorHandles('ゲスト先生', TABLE)).toEqual([{ name: 'ゲスト先生', handle: null }]);
  });

  it('同一ハンドルを2回招待しない', () => {
    expect(resolveInstructorHandles('TARO / TARO', TABLE)).toEqual([{ name: 'TARO', handle: 'taro_bsb' }]);
  });

  it('Instagramの上限3人を超える分は呼び出し側で切る(ここでは全員返す)', () => {
    const r = resolveInstructorHandles('TARO & Ryuki & AOI & KEIKO', TABLE);
    expect(r.map((x) => x.handle)).toEqual(['taro_bsb', 'takaryu_1203', 'aoi.w_0530', 'm55keiko']);
  });
});
