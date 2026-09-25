import { describe, it, expect } from 'vitest';
import {
  BF6_FORMAT,
  bracketSizeFor,
  formatFor,
  qualifierCountFor,
  qualifierPerBlockFor,
  roundsForSize,
  usesBlocks,
} from '../bf6Format';

// ⚠️ ここが今日の本番の形。変えるときは中身を1箇所だけ書き換える。
describe('いまの形式(2026-09-17時点)', () => {
  it('ビギナーは予選なしのベスト16', () => {
    expect(formatFor('beginner')).toEqual({ qualifier: 'none', bracketSize: 16 });
  });

  it('小中学生はA/B予選のベスト8', () => {
    expect(formatFor('kids')).toEqual({ qualifier: 'ab', bracketSize: 8 });
  });

  // 締切時点で18名になったのでA/Bの2サークルに分け、各4名通過=ベスト8(TARO 2026-09-25)
  it('一般はA/B予選のベスト8', () => {
    expect(formatFor('general')).toEqual({ qualifier: 'ab', bracketSize: 8 });
  });
});

describe('本戦の段', () => {
  it('16ならベスト16から', () => {
    expect(roundsForSize(16)).toEqual(['r16', 'qf', 'sf', 'f']);
  });

  it('8ならベスト8から', () => {
    expect(roundsForSize(8)).toEqual(['qf', 'sf', 'f']);
  });

  it('4なら準決勝から', () => {
    expect(roundsForSize(4)).toEqual(['sf', 'f']);
  });

  it('決勝は必ず最後', () => {
    for (const n of [4, 8, 16] as const) {
      const r = roundsForSize(n);
      expect(r[r.length - 1]).toBe('f');
    }
  });

  it('段数は枠が半分になる回数と一致する', () => {
    expect(roundsForSize(4)).toHaveLength(2);
    expect(roundsForSize(8)).toHaveLength(3);
    expect(roundsForSize(16)).toHaveLength(4);
  });
});

describe('予選で送り出す人数', () => {
  it('本戦の枠数と同じ', () => {
    expect(qualifierCountFor('kids')).toBe(bracketSizeFor('kids'));
    expect(qualifierCountFor('general')).toBe(bracketSizeFor('general'));
  });

  it('予選のない部門は0(選ばせない)', () => {
    expect(qualifierCountFor('beginner')).toBe(0);
  });
});

describe('ブロックごとの上限', () => {
  it('A/Bに分ける部門は、本戦枠の半分ずつ', () => {
    expect(qualifierPerBlockFor('kids')).toBe(4);
  });

  it('A/Bに分けないなら上限なし(nullを返す)', () => {
    expect(qualifierPerBlockFor('beginner')).toBeNull();
  });
});

describe('A/Bブロックを使うか', () => {
  it('いまは小中と一般が使う(ビギナーは予選なし)', () => {
    expect(usesBlocks('kids')).toBe(true);
    expect(usesBlocks('general')).toBe(true);
    expect(usesBlocks('beginner')).toBe(false);
  });
});

describe('形式を変えたときの波及(将来の切り替え)', () => {
  const withFormat = <T>(division: 'general', next: (typeof BF6_FORMAT)['general'], fn: () => T): T => {
    const before = BF6_FORMAT[division];
    BF6_FORMAT[division] = next;
    try {
      return fn();
    } finally {
      BF6_FORMAT[division] = before;
    }
  };

  it('一般をベスト4にすると、段が準決勝からになり通過者も4名になる', () => {
    withFormat('general', { qualifier: 'ab', bracketSize: 4 }, () => {
      expect(roundsForSize(bracketSizeFor('general'))).toEqual(['sf', 'f']);
      expect(qualifierCountFor('general')).toBe(4);
      expect(qualifierPerBlockFor('general')).toBe(2);
    });
  });

  it('一般を1サークル予選にすると、ブロックの上限が外れる', () => {
    withFormat('general', { qualifier: 'single', bracketSize: 8 }, () => {
      expect(usesBlocks('general')).toBe(false);
      expect(qualifierPerBlockFor('general')).toBeNull();
      expect(qualifierCountFor('general')).toBe(8);
    });
  });

  it('戻したら元の形に戻っている(テストが他に漏れない)', () => {
    expect(formatFor('general')).toEqual({ qualifier: 'ab', bracketSize: 8 });
  });
});

// ── 通過者の選択(部門ごとの人数・上限) ──
describe('通過者の選択が部門ごとの人数に従う', () => {
  const blocks = (a: number, b: number): ('A' | 'B')[] => [
    ...Array<'A'>(a).fill('A'),
    ...Array<'B'>(b).fill('B'),
  ];

  it('小中はいまベスト8なので、8名で揃う', async () => {
    const { qualifiersReadyFor } = await import('../bf6Qualifier');
    expect(qualifiersReadyFor('kids', 7)).toBe(false);
    expect(qualifiersReadyFor('kids', 8)).toBe(true);
    expect(qualifiersReadyFor('kids', 9)).toBe(false);
  });

  it('Aブロック5人目は選べない(いまは各4名)', async () => {
    const { qualifierPickErrorFor } = await import('../bf6Qualifier');
    expect(qualifierPickErrorFor('kids', blocks(4, 0), 'A')).toContain('Aブロック');
    expect(qualifierPickErrorFor('kids', blocks(3, 0), 'A')).toBeNull();
  });

  it('合計が埋まったらそれ以上選べない', async () => {
    const { qualifierPickErrorFor } = await import('../bf6Qualifier');
    expect(qualifierPickErrorFor('kids', blocks(4, 4), 'A')).toContain('8名');
  });

  it('9人目は追加されない', async () => {
    const { toggleQualifierFor } = await import('../bf6Qualifier');
    const eight = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(toggleQualifierFor('kids', eight, 9).size).toBe(8);
    expect(toggleQualifierFor('kids', eight, 1).size).toBe(7);
  });

  it('ベスト4に変えると、4名で揃い、ブロック上限も2名になる', async () => {
    const { BF6_FORMAT } = await import('../bf6Format');
    const { qualifiersReadyFor, qualifierPickErrorFor } = await import('../bf6Qualifier');
    const before = BF6_FORMAT.general;
    BF6_FORMAT.general = { qualifier: 'ab', bracketSize: 4 };
    try {
      expect(qualifiersReadyFor('general', 4)).toBe(true);
      expect(qualifiersReadyFor('general', 8)).toBe(false);
      expect(qualifierPickErrorFor('general', blocks(2, 0), 'A')).toContain('Aブロック');
      expect(qualifierPickErrorFor('general', blocks(1, 0), 'A')).toBeNull();
    } finally {
      BF6_FORMAT.general = before;
    }
  });

  it('1サークル予選に変えると、ブロックの上限が効かなくなる', async () => {
    const { BF6_FORMAT } = await import('../bf6Format');
    const { qualifierPickErrorFor } = await import('../bf6Qualifier');
    const before = BF6_FORMAT.general;
    BF6_FORMAT.general = { qualifier: 'single', bracketSize: 8 };
    try {
      // 同じブロックから5人選んでも止めない(そもそもブロックが無い)
      expect(qualifierPickErrorFor('general', blocks(5, 0), 'A')).toBeNull();
      // 合計の上限は効く
      expect(qualifierPickErrorFor('general', blocks(8, 0), 'A')).toContain('8名');
    } finally {
      BF6_FORMAT.general = before;
    }
  });
});
