import { describe, it, expect } from 'vitest';
import { computeStageCast, mergeStageCast, mIdFromDriveName } from '../stageCast';

const members = [
  { id: 1, full_name: '岸柳 蓮杏', handle: 'lea413785', owner_kind: 'self' },
  { id: 2, full_name: '内海心葵', handle: 'riho_24_', owner_kind: 'mother' },
  { id: 3, full_name: '遠藤彩', handle: null, owner_kind: null },
  { id: 4, full_name: '佐藤花', handle: 'a_hana', owner_kind: 'self' },
  { id: 5, full_name: '佐藤花', handle: 'b_hana', owner_kind: 'self' }, // 同名2人
];

describe('mIdFromDriveName', () => {
  it('ゼロ埋め・枝番を外して名簿の書式に', () => {
    expect(mIdFromDriveName('M06-2.mp4')).toBe('M6');
    expect(mIdFromDriveName('M22.mp4')).toBe('M22');
    expect(mIdFromDriveName('IMG_1.MOV')).toBeNull();
  });
});

describe('computeStageCast', () => {
  it('会員名簿のハンドルで照合し、未登録は「聞いて」側に出す', () => {
    const r = computeStageCast(
      [
        { id: 10, m_id: 'M6', name: '岸柳蓮杏' },
        { id: 11, m_id: 'M6', name: '内海 心葵' },
        { id: 12, m_id: 'M6', name: '遠藤彩' },
        { id: 13, m_id: 'M6', name: '外部ゲスト' },
      ],
      members
    );
    expect(r.known.map((k) => k.handle)).toEqual(['lea413785', 'riho_24_']);
    expect(r.known[1].name).toBe('内海 心葵（母）');
    expect(r.unknown.map((u) => u.name)).toEqual(['遠藤彩', '外部ゲスト']);
  });

  it('同名2人は照合しない(誤タグ防止)', () => {
    const r = computeStageCast([{ id: 20, m_id: 'M6', name: '佐藤花' }], members);
    expect(r.known).toEqual([]);
    expect(r.unknown[0].kind).toBe('performer');
  });

  it('非会員は出演者名簿側のハンドルを使う', () => {
    const r = computeStageCast([{ id: 30, m_id: 'M6', name: 'ゲスト', handle_father: 'guest_papa' }], members);
    expect(r.known).toEqual([{ kind: 'performer', id: 30, name: 'ゲスト（父）', handle: 'guest_papa' }]);
  });

  it('tag_consent=0 の人は候補にも「聞いて」にも出さず declined に入れる', () => {
    const r = computeStageCast(
      [
        { id: 10, m_id: 'M6', name: '岸柳蓮杏', tag_consent: 0 },
        { id: 12, m_id: 'M6', name: '遠藤彩', tag_consent: 0 },
      ],
      members
    );
    expect(r.known).toEqual([]);
    expect(r.unknown).toEqual([]);
    expect(r.declined).toEqual(['lea413785']);
  });

  it('tag_consent が NULL(未確認)なら載せる', () => {
    const r = computeStageCast([{ id: 10, m_id: 'M6', name: '岸柳蓮杏', tag_consent: null }], members);
    expect(r.known.map((k) => k.handle)).toEqual(['lea413785']);
  });
});

describe('mergeStageCast(投稿直前の最新化)', () => {
  it('予約後に登録された人を後ろに足す(今回の目的)', () => {
    const r = mergeStageCast(['riho_24_', 'lea413785'], ['riho_24_', 'lea413785', 'new_kid'], [], []);
    expect(r.handles).toEqual(['riho_24_', 'lea413785', 'new_kid']);
    expect(r.added).toEqual(['new_kid']);
    expect(r.removed).toEqual([]);
  });

  it('手で足した人(名簿に居ない)は消さない', () => {
    const r = mergeStageCast(['manual_guest'], ['riho_24_'], [], []);
    expect(r.handles).toEqual(['manual_guest', 'riho_24_']);
  });

  it('共同投稿者は足さない(講師本人が保護者アカウントで名簿に居るケース)', () => {
    const r = mergeStageCast(['riho_24_'], ['riho_24_', 'kattsu_ziel'], ['kattsu_ziel', 'aoi.w_0530'], []);
    expect(r.handles).toEqual(['riho_24_']);
    expect(r.added).toEqual([]);
  });

  it('載せないでと言われた人は、既に入っていても外す', () => {
    const r = mergeStageCast(['riho_24_', 'lea413785'], ['riho_24_'], [], ['lea413785']);
    expect(r.handles).toEqual(['riho_24_']);
    expect(r.removed).toEqual(['lea413785']);
  });

  it('@付き・大文字小文字の揺れで二重にしない', () => {
    const r = mergeStageCast(['@Riho_24_'], ['riho_24_'], [], []);
    expect(r.handles).toEqual(['Riho_24_']);
    expect(r.added).toEqual([]);
  });

  it('上限20を超えて足さない', () => {
    const current = Array.from({ length: 19 }, (_, i) => `k${i}`);
    const r = mergeStageCast(current, ['n1', 'n2', 'n3'], [], []);
    expect(r.handles).toHaveLength(20);
    expect(r.added).toEqual(['n1']);
  });

  it('変化なしなら added/removed は空', () => {
    const r = mergeStageCast(['a', 'b'], ['b', 'a'], [], []);
    expect(r).toEqual({ handles: ['a', 'b'], added: [], removed: [] });
  });
});
