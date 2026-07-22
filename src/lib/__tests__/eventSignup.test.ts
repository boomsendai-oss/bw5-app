import { describe, it, expect } from 'vitest';
import {
  PART_KEYS,
  isPartKey,
  validateSignupInput,
  generateEditToken,
  buildSignupCsv,
  countByPart,
  defaultSettings,
} from '../eventSignup';

describe('isPartKey', () => {
  it('正しいキーだけ true', () => {
    expect(isPartKey('girls_hh')).toBe(true);
    expect(isPartKey('waack')).toBe(true);
    expect(isPartKey('hiphop')).toBe(true);
    expect(isPartKey('ballet')).toBe(false);
    expect(isPartKey('')).toBe(false);
  });
});

describe('validateSignupInput', () => {
  const ok = {
    understood: true,
    note: ' メモ ',
    performers: [
      { name: ' タロウ ', parts: ['girls_hh', 'girls_hh', 'waack'] },
      { name: '', parts: [] },
      { name: 'ジロウ', parts: ['hiphop'] },
    ],
  };

  it('正常系: 空行を捨て・名前trim・パート重複除去', () => {
    const r = validateSignupInput(ok);
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.note).toBe('メモ');
    expect(r.performers).toEqual([
      { name: 'タロウ', parts: ['girls_hh', 'waack'] },
      { name: 'ジロウ', parts: ['hiphop'] },
    ]);
  });

  it('カタカナ以外の名前はエラー（ひらがな・漢字・英字）', () => {
    expect(validateSignupInput({ understood: true, performers: [{ name: 'たろう', parts: ['waack'] }] })).toContain('カタカナ');
    expect(validateSignupInput({ understood: true, performers: [{ name: '太郎', parts: ['waack'] }] })).toContain('カタカナ');
    expect(validateSignupInput({ understood: true, performers: [{ name: 'Taro', parts: ['waack'] }] })).toContain('カタカナ');
  });

  it('カタカナ＋長音符・中点・スペースは許可', () => {
    const r = validateSignupInput({ understood: true, performers: [{ name: 'サトウ　ハナ・コ', parts: ['waack'] }] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.performers[0].name).toBe('サトウ　ハナ・コ');
  });

  it('理解チェック未通過はエラー', () => {
    expect(validateSignupInput({ ...ok, understood: false })).toContain('チェック');
  });

  it('出演者が0人はエラー', () => {
    expect(validateSignupInput({ understood: true, performers: [{ name: '', parts: [] }] })).toContain('1人以上');
  });

  it('パート未選択の出演者はエラー(名前入り)', () => {
    const r = validateSignupInput({ understood: true, performers: [{ name: 'ハナコ', parts: [] }] });
    expect(r).toContain('ハナコ');
    expect(r).toContain('パート');
  });

  it('不正なパートキーは無視される', () => {
    const r = validateSignupInput({ understood: true, performers: [{ name: 'エー', parts: ['ballet', 'waack'] }] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.performers[0].parts).toEqual(['waack']);
  });

  it('11人以上はエラー', () => {
    const performers = Array.from({ length: 11 }, () => ({ name: 'テスト', parts: ['waack'] }));
    expect(validateSignupInput({ understood: true, performers })).toContain('10人');
  });
});

describe('generateEditToken', () => {
  it('十分長い16進で毎回違う', () => {
    const a = generateEditToken();
    const b = generateEditToken();
    expect(a).toMatch(/^[0-9a-f]{32,}$/);
    expect(a).not.toBe(b);
  });
});

describe('countByPart', () => {
  it('パートごとに人数を数える(複数パートは各カウント)', () => {
    const r = countByPart([
      { parts: ['girls_hh', 'waack'] },
      { parts: ['waack'] },
      { parts: ['hiphop'] },
    ]);
    expect(r).toEqual({ girls_hh: 1, waack: 2, hiphop: 1 });
  });
});

describe('buildSignupCsv', () => {
  it('ヘッダ+1行1出演者・パートはラベルを / 連結・カンマはエスケープ', () => {
    const csv = buildSignupCsv(
      [{ performerName: '太郎', parts: ['girls_hh', 'waack'], createdAt: '2026-07-22T00:00:00.000Z' }],
      { girls_hh: 'ガールズHIPHOP', waack: 'WAACK', hiphop: 'HIPHOP' }
    );
    expect(csv).toContain('出演者名,希望パート,申込日時');
    expect(csv).toContain('太郎,ガールズHIPHOP / WAACK,2026-07-22T00:00:00.000Z');
  });
});

describe('defaultSettings', () => {
  it('参加費3000円・パート3種・受付ON', () => {
    const s = defaultSettings();
    expect(s.feeText).toContain('3,000');
    expect(s.parts.map((p) => p.key)).toEqual([...PART_KEYS]);
    expect(s.isOpen).toBe(true);
  });
});
