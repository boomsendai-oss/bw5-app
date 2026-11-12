import { describe, it, expect } from 'vitest';
import { dammDigit, isValidRef, pickRef, readRefFromDesc, RESERVED_REFS } from '../recitalRef';

const ALL = Array.from({ length: 900 }, (_, i) => `${i + 100}${dammDigit(String(i + 100))}`);

describe('検査の数字（Damm）', () => {
  it.each([['100', '1007'], ['123', '1234'], ['572', '5724'], ['905', '9054'], ['999', '9990'], ['482', '4823']])(
    '%s → %s', (three, code) => { expect(`${three}${dammDigit(three)}`).toBe(code); expect(isValidRef(code)).toBe(true); });
  it('4827・8427・4287 は合わない。形のちがう物も合わない', () => {
    for (const c of ['4827', '8427', '4287', '0007', '100', '10070', '１００７', 'abcd']) expect(isValidRef(c)).toBe(false);
  });
  it('1けたの打ちまちがい 32,400通りを全部見つける', () => {
    let n = 0, miss = 0;
    for (const c of ALL) for (let p = 0; p < 4; p++) for (const d of '0123456789') {
      if (d === c[p]) continue; n++;
      if (isValidRef(c.slice(0, p) + d + c.slice(p + 1))) miss++;
    }
    expect([n, miss]).toEqual([32400, 0]);
  });
  it('となりどうしの入れかえ 2,430通りを全部見つける', () => {
    let n = 0, miss = 0;
    for (const c of ALL) for (let p = 0; p < 3; p++) {
      if (c[p] === c[p + 1]) continue; n++;
      if (isValidRef(c.slice(0, p) + c[p + 1] + c[p] + c.slice(p + 2))) miss++;
    }
    expect([n, miss]).toEqual([2430, 0]);
  });
});

describe('出す（pickRef）', () => {
  it('欠番10個はどれも検査に合う番号で、出さない', () => {
    expect(RESERVED_REFS).toHaveLength(10);
    for (const r of RESERVED_REFS) expect(isValidRef(r)).toBe(true);
  });
  it('使い切るまで出すと 888個（890個から ref_skip の検査に合う2つが減る）。欠番・skip・使用ずみを出さず、重ならない', () => {
    const skip = ['2008', '3009', '4827', 'abc'];
    const used = new Set<string>();
    let seed = 7;
    const rand = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
    for (let r = pickRef(used, skip, rand); r !== null; r = pickRef(used, skip, rand)) {
      expect(isValidRef(r)).toBe(true);
      expect(RESERVED_REFS).not.toContain(r);
      expect(['2008', '3009']).not.toContain(r);
      expect(used.has(r)).toBe(false);
      used.add(r);
    }
    expect(used.size).toBe(888);
  });
  it('rand=0 は空いている中でいちばん小さい番号（1007 は欠番なので 1010）', () => {
    expect(pickRef(new Set(), [], () => 0)).toBe('1010');
    expect(pickRef(new Set(['1010']), [], () => 0)).toBe('1029');
  });
  it('使い切ったら null', () => {
    expect(pickRef(new Set(ALL), [], () => 0)).toBeNull();
  });
});

describe('摘要から読む（D5 2-16 の読む位置）', () => {
  it.each([
    ['振込 4827 ヤマダ ハナコ', '4827', false, 'ヤマダハナコ'],
    ['振込１００７－ヤマダハナコ', '1007', true, 'ヤマダハナコ'],
    ['振込　4823・ﾔﾏﾀﾞ ﾊﾅｺ', '4823', true, 'ヤマダハナコ'],
    ['振込 4823ヤマダハナコ 0123456', '4823', true, 'ヤマダハナコ0123456'],
    ['振込 482 ヤマダハナコ', null, false, '482ヤマダハナコ'],
    ['振込 48231 ヤマダハナコ', null, false, '48231ヤマダハナコ'],
    ['振込 ヤマダハナコ 4823', null, false, 'ヤマダハナコ4823'],
    ['4823 ヤマダハナコ', null, false, '4823ヤマダハナコ'],   // 頭に「振込」が無ければ番号を読まない（決まり。読む役は Task 30 で「振込」から写す）
    ['ヤマダハナコ 4823', null, false, 'ヤマダハナコ4823'],
  ] as const)('%s', (raw, ref, ok, name) => {
    const r = readRefFromDesc(raw);
    expect([r.ref, r.refOk, r.nameRaw]).toEqual([ref, ok, name]);
    expect(r.descNorm).not.toMatch(/\s/);
  });
});
