// 例の番号は 4827（検査に合わない）。検査に合う例が要る時は欠番（`RESERVED_REFS`）の番号だけを使う。これより外の番号・名前を例に作らない（D5 2-16・K139）
// BW6 発表会（段階1）の整理番号。数字4けた＝前の3けた（100〜999）＋検査の数字1けた（Damm。K135）。
// 純関数。DB にさわらない。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 決まりの正本は設計書 03 3-2「整理番号」（D5 2-16・K135〜K140）。

/** Damm の表。T[今の c][けたの数字]（行＝今の c、列＝けたの数字）。設計書 03 3-2 のまま */
const T: readonly (readonly number[])[] = [
  [0, 3, 1, 7, 5, 9, 8, 6, 4, 2],
  [7, 0, 9, 2, 1, 5, 4, 8, 6, 3],
  [4, 2, 0, 6, 8, 7, 1, 3, 5, 9],
  [1, 7, 5, 0, 9, 8, 3, 4, 2, 6],
  [6, 1, 2, 3, 0, 4, 5, 9, 7, 8],
  [3, 6, 7, 4, 2, 0, 9, 5, 8, 1],
  [5, 8, 6, 9, 7, 2, 0, 1, 3, 4],
  [8, 9, 4, 5, 3, 6, 2, 0, 1, 7],
  [9, 4, 3, 8, 6, 1, 7, 2, 0, 5],
  [2, 5, 8, 1, 4, 3, 6, 7, 9, 0],
];

/** 家庭に出さない番号（K137）。検査の例5つ＋例の番号 4827 から1けたちがい・となりの入れかえで行ける検査に合う5つ */
export const RESERVED_REFS: readonly string[] = ['1007', '1234', '5724', '9054', '9990', '4727', '4823', '4867', '4872', '9827'];

/** 番号のすぐあとの区切り1文字の並び（摘要を読む時に取る。26 の surnameMatches も import して使う） */
export const REF_SEPARATORS = '-‐‑‒–—―−ー・.,、。/';

/** c=0 から左のけたへ c = T[c][digit]。3けたを通せば検査の数字、4けたを通して 0 なら検査に合う */
export function dammDigit(digits: string): number {
  let c = 0;
  for (const ch of digits) c = T[c][Number(ch)];
  return c;
}

export function isValidRef(code: string): boolean {
  return /^[1-9]\d{3}$/.test(code) && dammDigit(code) === 0;
}

/** 100〜999 に検査の数字を付けた900個（小さい順） */
const ALL_REFS: readonly string[] = Array.from({ length: 900 }, (_, i) => `${i + 100}${dammDigit(String(i + 100))}`);

/** 空いている番号（欠番・skip・used を除いた小さい順）の Math.floor(rand() × 長さ) 番目。空なら null */
export function pickRef(used: ReadonlySet<string>, skip: readonly string[], rand: () => number): string | null {
  const reserved = new Set<string>([...RESERVED_REFS, ...skip]);
  const free = ALL_REFS.filter((r) => !reserved.has(r) && !used.has(r));
  if (free.length === 0) return null;
  return free[Math.min(free.length - 1, Math.floor(rand() * free.length))];
}

const escapeForClass = (s: string) => s.replace(/[\\\]\[^\-]/g, (ch) => `\\${ch}`);
const REF_AT_HEAD = new RegExp(`^(\\d{4})(?!\\d)[${escapeForClass(REF_SEPARATORS)}]?`);

/**
 * 摘要から整理番号を読む（D5 2-16・K140）。
 * NFKC でそろえて空白を全部取る→頭の「振込」を外す→すぐあとが数字ちょうど4つ（5つ目が数字でない）ならそれが番号。
 * 番号のすぐあとの区切り1文字は取る。後ろの口座番号などの数字は読まない（nameRaw に残るだけ）。
 */
export function readRefFromDesc(descRaw: string): { ref: string | null; refOk: boolean; nameRaw: string; descNorm: string } {
  const descNorm = descRaw.normalize('NFKC').replace(/\s/g, '');
  if (!descNorm.startsWith('振込')) return { ref: null, refOk: false, nameRaw: descNorm, descNorm };
  const rest = descNorm.slice('振込'.length);
  const m = REF_AT_HEAD.exec(rest);
  if (!m) return { ref: null, refOk: false, nameRaw: rest, descNorm };
  const ref = m[1];
  return { ref, refOk: isValidRef(ref), nameRaw: rest.slice(m[0].length), descNorm };
}
