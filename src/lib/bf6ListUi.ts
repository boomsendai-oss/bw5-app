// 当日オペの一覧に共通の絞り込み。純ロジック・DBに触らない。
//
// 画面ごとに表現が違うと現場で迷うので、「まだ / 済んだ / 全員」のタブと名前の検索は
// 入場受付・写真撮影・集金で同じ形にする(TARO 2026-09-11)。

export type DoneTab = 'todo' | 'done' | 'all';

export function filterDoneTab<T>(rows: T[], isDone: (row: T) => boolean, tab: DoneTab): T[] {
  if (tab === 'all') return rows;
  return rows.filter((r) => isDone(r) === (tab === 'done'));
}

export function doneTabCounts<T>(rows: T[], isDone: (row: T) => boolean): Record<DoneTab, number> {
  const done = rows.filter(isDone).length;
  return { todo: rows.length - done, done, all: rows.length };
}

/** 全角→半角、カタカナ→ひらがな、空白を落として小文字化。当日は急いで打つのでゆるく当てる。 */
export function normalizeJa(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '')
    .toLowerCase();
}

/** 名前・フリガナなど、どれか1つに当たれば true。検索が空なら全件。 */
export function matchesAny(fields: (string | null | undefined)[], q: string): boolean {
  const k = normalizeJa(q);
  if (!k) return true;
  return fields.some((f) => f && normalizeJa(f).includes(k));
}
