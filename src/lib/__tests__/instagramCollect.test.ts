import { describe, it, expect } from 'vitest';
import {
  normalizeHandle,
  isOwnerKind,
  ownerKindLabel,
  validateCollectInput,
  suggestMatches,
  generateEditToken,
  type MemberForIgMatch,
} from '../instagramCollect';

describe('normalizeHandle', () => {
  it('素のアカウント名はそのまま小文字化して返す', () => {
    expect(normalizeHandle('boom_sendai')).toEqual({ ok: true, handle: 'boom_sendai' });
    expect(normalizeHandle('BOOM_Sendai')).toEqual({ ok: true, handle: 'boom_sendai' });
  });

  it('先頭の @ を落とす（全角＠も）', () => {
    expect(normalizeHandle('@boom_sendai')).toEqual({ ok: true, handle: 'boom_sendai' });
    expect(normalizeHandle('＠boom_sendai')).toEqual({ ok: true, handle: 'boom_sendai' });
  });

  it('プロフィールURLを貼られてもアカウント名を抜き出す', () => {
    expect(normalizeHandle('https://www.instagram.com/boom_sendai/')).toEqual({ ok: true, handle: 'boom_sendai' });
    expect(normalizeHandle('instagram.com/boom_sendai')).toEqual({ ok: true, handle: 'boom_sendai' });
    // 共有リンクに付いてくる ?igsh=... を落とす
    expect(normalizeHandle('https://instagram.com/boom_sendai?igsh=abc123')).toEqual({ ok: true, handle: 'boom_sendai' });
    // アプリの共有は末尾に profilecard が付くことがある
    expect(normalizeHandle('https://www.instagram.com/boom_sendai/profilecard/?igsh=x')).toEqual({ ok: true, handle: 'boom_sendai' });
  });

  it('全角英数字を半角に寄せる（スマホ入力の事故）', () => {
    expect(normalizeHandle('ｂｏｏｍ＿ｓｅｎｄａｉ')).toEqual({ ok: true, handle: 'boom_sendai' });
  });

  it('前後の空白を落とす', () => {
    expect(normalizeHandle('  @boom_sendai 　')).toEqual({ ok: true, handle: 'boom_sendai' });
  });

  it('空はエラー', () => {
    expect(normalizeHandle('')).toEqual({ ok: false, error: 'Instagramのアカウント名を入力してください' });
    expect(normalizeHandle('   ')).toEqual({ ok: false, error: 'Instagramのアカウント名を入力してください' });
    expect(normalizeHandle('@')).toEqual({ ok: false, error: 'Instagramのアカウント名を入力してください' });
  });

  it('Instagramで使えない文字はエラー', () => {
    // 日本語は使えない（表示名を書いてしまう事故を弾く）
    expect(normalizeHandle('ブーム仙台').ok).toBe(false);
    expect(normalizeHandle('boom sendai').ok).toBe(false);
    expect(normalizeHandle('boom-sendai').ok).toBe(false);
    expect(normalizeHandle('boom/sendai').ok).toBe(false);
  });

  it('30文字を超えるものはエラー（Instagramの上限）', () => {
    expect(normalizeHandle('a'.repeat(30))).toEqual({ ok: true, handle: 'a'.repeat(30) });
    expect(normalizeHandle('a'.repeat(31)).ok).toBe(false);
  });

  it('ピリオドとアンダースコアは使える', () => {
    expect(normalizeHandle('b.o_o.m')).toEqual({ ok: true, handle: 'b.o_o.m' });
  });
});

describe('isOwnerKind / ownerKindLabel', () => {
  it('4種類だけ受け付ける', () => {
    expect(isOwnerKind('self')).toBe(true);
    expect(isOwnerKind('father')).toBe(true);
    expect(isOwnerKind('mother')).toBe(true);
    expect(isOwnerKind('other')).toBe(true);
    expect(isOwnerKind('brother')).toBe(false);
    expect(isOwnerKind('')).toBe(false);
  });

  it('日本語ラベルを返す', () => {
    expect(ownerKindLabel('self')).toBe('本人');
    expect(ownerKindLabel('father')).toBe('父');
    expect(ownerKindLabel('mother')).toBe('母');
    expect(ownerKindLabel('other')).toBe('その他');
  });
});

describe('validateCollectInput', () => {
  const ok = {
    entries: [
      { memberName: ' 木村 花子 ', memberNameKana: ' キムラ ハナコ ', handle: '@hanako_b', ownerKind: 'self' },
    ],
  };

  it('正常系: 前後空白を落として返す', () => {
    const r = validateCollectInput(ok);
    expect(typeof r).not.toBe('string');
    if (typeof r === 'string') return;
    expect(r.entries).toEqual([
      { memberName: '木村 花子', memberNameKana: 'キムラ ハナコ', handle: 'hanako_b', ownerKind: 'self' },
    ]);
  });

  it('空行は無視する（＋もう1人追加を押しただけの行）', () => {
    const r = validateCollectInput({
      entries: [
        ok.entries[0],
        { memberName: '', memberNameKana: '', handle: '', ownerKind: '' },
      ],
    });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entries).toHaveLength(1);
  });

  it('1件も入力が無ければエラー', () => {
    expect(validateCollectInput({ entries: [] })).toBe('入力がありません');
    expect(
      validateCollectInput({ entries: [{ memberName: '', memberNameKana: '', handle: '', ownerKind: '' }] })
    ).toBe('入力がありません');
  });

  it('氏名が無ければエラー', () => {
    const r = validateCollectInput({ entries: [{ ...ok.entries[0], memberName: '' }] });
    expect(r).toBe('お名前を入力してください');
  });

  it('カナが無ければエラー', () => {
    const r = validateCollectInput({ entries: [{ ...ok.entries[0], memberNameKana: '' }] });
    expect(typeof r).toBe('string');
    expect(String(r)).toContain('フリガナ');
  });

  it('カナがカタカナでなければエラー', () => {
    const r = validateCollectInput({ entries: [{ ...ok.entries[0], memberNameKana: 'きむら はなこ' }] });
    expect(typeof r).toBe('string');
    expect(String(r)).toContain('カタカナ');
  });

  it('続柄が未選択ならエラー', () => {
    const r = validateCollectInput({ entries: [{ ...ok.entries[0], ownerKind: '' }] });
    expect(typeof r).toBe('string');
    expect(String(r)).toContain('どなたのアカウント');
  });

  it('アカウント名が不正ならその行のエラーを返す', () => {
    const r = validateCollectInput({ entries: [{ ...ok.entries[0], handle: 'ブーム' }] });
    expect(typeof r).toBe('string');
  });

  it('氏名が長すぎればエラー', () => {
    const r = validateCollectInput({ entries: [{ ...ok.entries[0], memberName: 'あ'.repeat(51) }] });
    expect(typeof r).toBe('string');
    expect(String(r)).toContain('50文字');
  });

  it('一度に登録できるのは10人まで', () => {
    const many = Array.from({ length: 11 }, () => ok.entries[0]);
    expect(validateCollectInput({ entries: many })).toBe('一度に登録できるのは10人までです');
  });
});

describe('suggestMatches', () => {
  const members: MemberForIgMatch[] = [
    { id: 1, hacomono_member_id: 'M001', full_name: '木村 花子', full_name_kana: 'キムラ ハナコ', status: 'active', instagram_handle: null },
    { id: 2, hacomono_member_id: 'M002', full_name: '佐藤 太郎', full_name_kana: 'サトウ タロウ', status: 'active', instagram_handle: null },
    { id: 3, hacomono_member_id: 'M003', full_name: '佐藤 太郎', full_name_kana: 'サトウ タロウ', status: 'active', instagram_handle: null },
    { id: 4, hacomono_member_id: 'M004', full_name: '渡辺 みづき', full_name_kana: 'ワタナベ ミヅキ', status: 'active', instagram_handle: 'old_handle' },
  ];

  it('カナが一致すれば候補1件・確度「高」', () => {
    const r = suggestMatches(
      [{ id: 10, memberName: '木村 花子', memberNameKana: 'キムラ ハナコ', handle: 'hanako_b', ownerKind: 'self' }],
      members
    );
    expect(r).toHaveLength(1);
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates.map((c) => c.member_id)).toEqual([1]);
    expect(r[0].candidates[0].reason).toBe('kana');
  });

  it('カナの表記ゆれ（スペース・四つ仮名）を吸収する', () => {
    const r = suggestMatches(
      [{ id: 11, memberName: '渡辺 みづき', memberNameKana: 'ワタナベミズキ', handle: 'mizuki', ownerKind: 'mother' }],
      members
    );
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates[0].member_id).toBe(4);
  });

  it('同姓同名が複数いたら確定させず「要確認」にする', () => {
    const r = suggestMatches(
      [{ id: 12, memberName: '佐藤 太郎', memberNameKana: 'サトウ タロウ', handle: 'taro', ownerKind: 'self' }],
      members
    );
    expect(r[0].confidence).toBe('要確認');
    expect(r[0].candidates.map((c) => c.member_id).sort()).toEqual([2, 3]);
  });

  it('カナが外れても漢字が一致すれば候補に出す（reason=name）', () => {
    const r = suggestMatches(
      [{ id: 13, memberName: '木村 花子', memberNameKana: 'キムラ ハナ', handle: 'hana', ownerKind: 'self' }],
      members
    );
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates[0].member_id).toBe(1);
    expect(r[0].candidates[0].reason).toBe('name');
  });

  it('どちらも一致しなければ「なし」（自動確定しない）', () => {
    const r = suggestMatches(
      [{ id: 14, memberName: '存在 しない', memberNameKana: 'ソンザイ シナイ', handle: 'nobody', ownerKind: 'self' }],
      members
    );
    expect(r[0].confidence).toBe('なし');
    expect(r[0].candidates).toEqual([]);
  });

  it('既に別のアカウントが紐付いている会員は上書き注意フラグを立てる', () => {
    const r = suggestMatches(
      [{ id: 15, memberName: '渡辺 みづき', memberNameKana: 'ワタナベ ミヅキ', handle: 'new_handle', ownerKind: 'mother' }],
      members
    );
    expect(r[0].candidates[0].existing_handle).toBe('old_handle');
    expect(r[0].candidates[0].overwrites).toBe(true);
  });

  it('同じアカウントが既に紐付いているだけなら上書きにはしない', () => {
    const r = suggestMatches(
      [{ id: 16, memberName: '渡辺 みづき', memberNameKana: 'ワタナベ ミヅキ', handle: 'old_handle', ownerKind: 'mother' }],
      members
    );
    expect(r[0].candidates[0].overwrites).toBe(false);
  });

  it('兄弟で同じ親アカウントを出しても両方が候補になる（重複を弾かない）', () => {
    const r = suggestMatches(
      [
        { id: 17, memberName: '佐藤 太郎', memberNameKana: 'サトウ タロウ', handle: 'mama_sato', ownerKind: 'mother' },
        { id: 18, memberName: '木村 花子', memberNameKana: 'キムラ ハナコ', handle: 'mama_sato', ownerKind: 'mother' },
      ],
      members
    );
    expect(r).toHaveLength(2);
    expect(r[1].confidence).toBe('高');
  });

  it('退会済み会員も候補には出すが確度を下げる', () => {
    const r = suggestMatches(
      [{ id: 19, memberName: '退会 済', memberNameKana: 'タイカイ ズミ', handle: 'x', ownerKind: 'self' }],
      [{ id: 9, hacomono_member_id: 'M009', full_name: '退会 済', full_name_kana: 'タイカイ ズミ', status: 'withdrawn', instagram_handle: null }]
    );
    expect(r[0].confidence).toBe('要確認');
    expect(r[0].candidates[0].status).toBe('withdrawn');
  });
});

describe('generateEditToken', () => {
  it('十分な長さでユニーク', () => {
    const a = generateEditToken();
    const b = generateEditToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(a).toMatch(/^[0-9a-f]+$/);
  });
});
