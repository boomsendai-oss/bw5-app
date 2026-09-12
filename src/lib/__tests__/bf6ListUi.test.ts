import { describe, it, expect } from 'vitest';
import { filterDoneTab, doneTabCounts, normalizeJa, matchesAny } from '../bf6ListUi';

// 当日オペの一覧に共通の絞り込み。
// 入場受付で使った「未入場 / 入場済み / 全員」のタブを、写真撮影と集金にも同じ形で入れる
// (画面ごとに表現が違うと現場で迷う・TARO 2026-09-11)。
type Row = { id: number; done: boolean };
const rows: Row[] = [{ id: 1, done: true }, { id: 2, done: false }, { id: 3, done: false }];
const isDone = (r: Row) => r.done;

describe('済み・未済のタブ', () => {
  it('まだの人だけ', () => {
    expect(filterDoneTab(rows, isDone, 'todo').map((r) => r.id)).toEqual([2, 3]);
  });
  it('済んだ人だけ', () => {
    expect(filterDoneTab(rows, isDone, 'done').map((r) => r.id)).toEqual([1]);
  });
  it('全員', () => {
    expect(filterDoneTab(rows, isDone, 'all')).toHaveLength(3);
  });
  it('タブに出す件数', () => {
    expect(doneTabCounts(rows, isDone)).toEqual({ todo: 2, done: 1, all: 3 });
  });
});

describe('名前の検索(当日は急いで打つのでゆるく当てる)', () => {
  it('カタカナで打ってもひらがなの名前に当たる', () => {
    expect(matchesAny(['すずきはると'], 'スズキ')).toBe(true);
  });
  it('大文字小文字を無視する', () => {
    expect(matchesAny(['HIM@RI'], 'him')).toBe(true);
  });
  it('全角で打っても当たる', () => {
    expect(matchesAny(['HIM@RI'], 'ＨＩＭ')).toBe(true);
  });
  it('空白は無視する', () => {
    expect(matchesAny(['鈴木 花子'], '鈴木花子')).toBe(true);
  });
  it('複数の項目のどれかに当たればよい', () => {
    expect(matchesAny(['KANNA', 'イトウカンナ'], 'いとう')).toBe(true);
  });
  it('空の検索は全件', () => {
    expect(matchesAny(['なんでも'], '  ')).toBe(true);
  });
  it('中身が無い項目は無視する', () => {
    expect(matchesAny([null, undefined, ''], 'あ')).toBe(false);
  });
});

describe('名前の正規化', () => {
  it('カタカナはひらがなに、全角は半角に、空白は落とす', () => {
    expect(normalizeJa('スズキ　ハルト')).toBe('すずきはると');
    expect(normalizeJa('ＡＢ Ｃ')).toBe('abc');
  });
});
