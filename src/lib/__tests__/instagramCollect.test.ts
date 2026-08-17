import { describe, it, expect } from 'vitest';
import {
  normalizeHandle,
  isOwnerKind,
  ownerKindLabel,
  validateCollectInput,
  suggestMatches,
  generateEditToken,
  normalizeName,
  pickMentionHandle,
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

describe('validateCollectInput（本人・母・父の3段）', () => {
  const base = {
    memberName: ' 木村 花子 ',
    memberNameKana: ' キムラ ハナコ ',
    handleSelf: '@hanako_b',
    handleMother: '',
    handleFather: '',
  };

  it('正常系: 前後空白を落として3枠を返す', () => {
    const r = validateCollectInput({ entries: [base] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entries).toEqual([
      { memberName: '木村 花子', memberNameKana: 'キムラ ハナコ', handleSelf: 'hanako_b', handleMother: null, handleFather: null },
    ]);
  });

  it('本人・母・父を一度に入れられる', () => {
    const r = validateCollectInput({
      entries: [{ ...base, handleSelf: 'hanako', handleMother: '@mama_k', handleFather: 'https://instagram.com/papa_k/' }],
    });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entries[0]).toMatchObject({ handleSelf: 'hanako', handleMother: 'mama_k', handleFather: 'papa_k' });
  });

  it('母だけでも通る', () => {
    const r = validateCollectInput({ entries: [{ ...base, handleSelf: '', handleMother: 'mama_k' }] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entries[0]).toMatchObject({ handleSelf: null, handleMother: 'mama_k', handleFather: null });
  });

  it('父だけでも通る', () => {
    const r = validateCollectInput({ entries: [{ ...base, handleSelf: '', handleFather: 'papa_k' }] });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entries[0]).toMatchObject({ handleSelf: null, handleMother: null, handleFather: 'papa_k' });
  });

  it('3つとも空ならエラー（どれか1つは要る）', () => {
    const r = validateCollectInput({ entries: [{ ...base, handleSelf: '', handleMother: '', handleFather: '' }] });
    expect(typeof r).toBe('string');
    expect(String(r)).toContain('どれか1つ以上');
  });

  it('空行は無視する（＋もう1人追加を押しただけの行）', () => {
    const r = validateCollectInput({
      entries: [base, { memberName: '', memberNameKana: '', handleSelf: '', handleMother: '', handleFather: '' }],
    });
    if (typeof r === 'string') throw new Error(r);
    expect(r.entries).toHaveLength(1);
  });

  it('1件も入力が無ければエラー', () => {
    expect(validateCollectInput({ entries: [] })).toBe('入力がありません');
  });

  it('氏名が無ければエラー', () => {
    expect(validateCollectInput({ entries: [{ ...base, memberName: '' }] })).toBe('お名前を入力してください');
  });

  it('フリガナが無ければエラー', () => {
    expect(String(validateCollectInput({ entries: [{ ...base, memberNameKana: '' }] }))).toContain('フリガナ');
  });

  it('フリガナがひらがなならエラー（カタカナ必須）', () => {
    const r = validateCollectInput({ entries: [{ ...base, memberNameKana: 'きむら はなこ' }] });
    expect(String(r)).toContain('カタカナ');
  });

  it('フリガナが漢字ならエラー', () => {
    expect(String(validateCollectInput({ entries: [{ ...base, memberNameKana: '木村花子' }] }))).toContain('カタカナ');
  });

  it('フリガナが英字ならエラー', () => {
    expect(String(validateCollectInput({ entries: [{ ...base, memberNameKana: 'KIMURA HANAKO' }] }))).toContain('カタカナ');
  });

  it('母の欄に日本語を書いたらエラー（どの枠でも弾く）', () => {
    expect(typeof validateCollectInput({ entries: [{ ...base, handleMother: 'ままのあかうんと' }] })).toBe('string');
  });

  it('氏名が長すぎればエラー', () => {
    expect(String(validateCollectInput({ entries: [{ ...base, memberName: 'あ'.repeat(51) }] }))).toContain('50文字');
  });

  it('一度に登録できるのは10人まで', () => {
    const many = Array.from({ length: 11 }, () => base);
    expect(validateCollectInput({ entries: many })).toBe('一度に登録できるのは10人までです');
  });
});

describe('pickMentionHandle（本人>母>父）', () => {
  it('本人があれば本人', () => {
    expect(pickMentionHandle({ handleSelf: 'a', handleMother: 'b', handleFather: 'c' })).toEqual({ handle: 'a', kind: 'self' });
  });
  it('本人が無ければ母', () => {
    expect(pickMentionHandle({ handleSelf: null, handleMother: 'b', handleFather: 'c' })).toEqual({ handle: 'b', kind: 'mother' });
  });
  it('本人も母も無ければ父', () => {
    expect(pickMentionHandle({ handleSelf: null, handleMother: null, handleFather: 'c' })).toEqual({ handle: 'c', kind: 'father' });
  });
  it('全部空なら null', () => {
    expect(pickMentionHandle({})).toBeNull();
  });
});

const E = (id: number, name: string, kana: string, h: Partial<{ handleSelf: string | null; handleMother: string | null; handleFather: string | null }> = {}) => ({
  id, memberName: name, memberNameKana: kana,
  handleSelf: h.handleSelf ?? null, handleMother: h.handleMother ?? null, handleFather: h.handleFather ?? null,
});

describe('suggestMatches', () => {
  const members: MemberForIgMatch[] = [
    { id: 1, hacomono_member_id: 'M001', full_name: '木村 花子', full_name_kana: 'キムラ ハナコ', status: 'active', instagram_handle: null },
    { id: 2, hacomono_member_id: 'M002', full_name: '佐藤 太郎', full_name_kana: 'サトウ タロウ', status: 'active', instagram_handle: null },
    { id: 3, hacomono_member_id: 'M003', full_name: '佐藤 太郎', full_name_kana: 'サトウ タロウ', status: 'active', instagram_handle: null },
    { id: 4, hacomono_member_id: 'M004', full_name: '渡辺 みづき', full_name_kana: 'ワタナベ ミヅキ', status: 'active', instagram_handle: 'old_handle' },
  ];

  it('カナが一致すれば候補1件・確度「高」', () => {
    const r = suggestMatches([E(10, '木村 花子', 'キムラ ハナコ', { handleSelf: 'hanako_b' })], members);
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates.map((c) => c.member_id)).toEqual([1]);
    expect(r[0].candidates[0].reason).toBe('kana');
  });

  it('カナの表記ゆれ（スペース・四つ仮名）を吸収する', () => {
    const r = suggestMatches([E(11, '渡辺 みづき', 'ワタナベミズキ', { handleMother: 'mizuki' })], members);
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates[0].member_id).toBe(4);
  });

  it('同姓同名が複数いたら確定させず「要確認」にする', () => {
    const r = suggestMatches([E(12, '佐藤 太郎', 'サトウ タロウ', { handleSelf: 'taro' })], members);
    expect(r[0].confidence).toBe('要確認');
    expect(r[0].candidates.map((c) => c.member_id).sort()).toEqual([2, 3]);
  });

  it('カナが外れても漢字が一致すれば候補に出す（reason=name）', () => {
    const r = suggestMatches([E(13, '木村 花子', 'キムラ ハナ', { handleSelf: 'hana' })], members);
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates[0].member_id).toBe(1);
    expect(r[0].candidates[0].reason).toBe('name');
  });

  it('どちらも一致しなければ「なし」（自動確定しない）', () => {
    const r = suggestMatches([E(14, '存在 しない', 'ソンザイ シナイ', { handleSelf: 'nobody' })], members);
    expect(r[0].confidence).toBe('なし');
    expect(r[0].candidates).toEqual([]);
  });

  it('既に別のアカウントが入っている会員は上書き扱いにする', () => {
    const r = suggestMatches([E(15, '渡辺 みづき', 'ワタナベ ミヅキ', { handleSelf: 'new_handle' })], members);
    expect(r[0].candidates[0].existing.self).toBe('old_handle');
    expect(r[0].candidates[0].overwrites).toBe(true);
  });

  it('同じアカウントの再送信は上書きにしない', () => {
    const r = suggestMatches([E(16, '渡辺 みづき', 'ワタナベ ミヅキ', { handleSelf: 'old_handle' })], members);
    expect(r[0].candidates[0].overwrites).toBe(false);
  });

  it('兄弟で同じ親アカウントを出しても両方が候補になる（重複を弾かない）', () => {
    const r = suggestMatches(
      [E(17, '佐藤 太郎', 'サトウ タロウ', { handleMother: 'mama_sato' }), E(18, '木村 花子', 'キムラ ハナコ', { handleMother: 'mama_sato' })],
      members
    );
    expect(r).toHaveLength(2);
    expect(r[1].confidence).toBe('高');
  });

  it('退会済み会員も候補には出すが確度を下げる', () => {
    const r = suggestMatches(
      [E(19, '退会 済', 'タイカイ ズミ', { handleSelf: 'x' })],
      [{ id: 9, hacomono_member_id: 'M009', full_name: '退会 済', full_name_kana: 'タイカイ ズミ', status: 'withdrew', instagram_handle: null }]
    );
    expect(r[0].confidence).toBe('要確認');
    expect(r[0].candidates[0].status).toBe('withdrew');
  });

  it('母・父の枠もそれぞれ既存値と突き合わせる', () => {
    const m: MemberForIgMatch[] = [{
      id: 7, hacomono_member_id: 'M007', full_name: '林 こなつ', full_name_kana: 'ハヤシ コナツ', status: 'active',
      instagram_handle: null, instagram_handle_mother: 'mama_old', instagram_handle_father: null,
    }];
    const same = suggestMatches([E(21, '林 こなつ', 'ハヤシ コナツ', { handleMother: 'mama_old' })], m);
    expect(same[0].candidates[0].overwrites).toBe(false);
    const diff = suggestMatches([E(22, '林 こなつ', 'ハヤシ コナツ', { handleMother: 'mama_new' })], m);
    expect(diff[0].candidates[0].overwrites).toBe(true);
  });
});

describe('自動承認の判定（人の確認なしで会員DBに書いてよいか）', () => {
  const active: MemberForIgMatch = {
    id: 1, hacomono_member_id: 'M001', full_name: '木村 花子', full_name_kana: 'キムラ ハナコ',
    status: 'active', instagram_handle: null,
  };
  const entry = E(1, '木村 花子', 'キムラ ハナコ', { handleSelf: 'hanako' });

  it('カナも漢字も一致・候補1人・在籍中・アカウント未登録 → 自動承認する', () => {
    expect(suggestMatches([entry], [active])[0].auto_approvable).toBe(true);
  });

  it('同姓同名が2人いたら自動承認しない', () => {
    expect(suggestMatches([entry], [active, { ...active, id: 2, hacomono_member_id: 'M002' }])[0].auto_approvable).toBe(false);
  });

  it('カナだけ一致（漢字が違う）なら自動承認しない', () => {
    const r = suggestMatches([entry], [{ ...active, full_name: '喜村 花子' }])[0];
    expect(r.candidates[0].kana_match).toBe(true);
    expect(r.candidates[0].name_match).toBe(false);
    expect(r.auto_approvable).toBe(false);
  });

  it('漢字だけ一致（カナが違う）なら自動承認しない', () => {
    const r = suggestMatches([entry], [{ ...active, full_name_kana: 'キムラ ハナ' }])[0];
    expect(r.candidates[0].name_match).toBe(true);
    expect(r.candidates[0].kana_match).toBe(false);
    expect(r.auto_approvable).toBe(false);
  });

  it('退会済みなら自動承認しない', () => {
    expect(suggestMatches([entry], [{ ...active, status: 'withdrew' }])[0].auto_approvable).toBe(false);
  });

  it('既に別のアカウントが入っていたら自動承認しない（機械が黙って上書きしない）', () => {
    expect(suggestMatches([entry], [{ ...active, instagram_handle: 'other' }])[0].auto_approvable).toBe(false);
  });

  it('同じアカウントの再送信は自動承認する（値が変わらないので取り違えようがない）', () => {
    expect(suggestMatches([entry], [{ ...active, instagram_handle: 'hanako' }])[0].auto_approvable).toBe(true);
  });

  it('入っていた枠が今回空なら自動承認しない（機械が黙って消さない）', () => {
    const r = suggestMatches(
      [E(2, '木村 花子', 'キムラ ハナコ', { handleSelf: 'hanako' })],
      [{ ...active, instagram_handle: 'hanako', instagram_handle_mother: 'mama' }]
    );
    expect(r[0].auto_approvable).toBe(false);
  });

  it('候補が0人なら自動承認しない', () => {
    expect(suggestMatches([entry], [])[0].auto_approvable).toBe(false);
  });

  it('異体字ちがいの会員でも、カナが一致していれば自動承認する', () => {
    const r = suggestMatches(
      [E(3, '高橋 凛花', 'タカハシ リンカ', { handleSelf: 'rin' })],
      [{ id: 9, hacomono_member_id: 'M009', full_name: '髙橋 凛花', full_name_kana: 'タカハシ リンカ', status: 'active', instagram_handle: null }]
    );
    expect(r[0].auto_approvable).toBe(true);
  });
});

describe('normalizeName（異体字の寄せ）', () => {
  it('旧字体/異体字を新字体に寄せる（実データで取り違えが起きた組み合わせ）', () => {
    expect(normalizeName('髙橋 凛花')).toBe(normalizeName('高橋凛花'));
    expect(normalizeName('大澤 覇溜')).toBe(normalizeName('大沢覇溜'));
    expect(normalizeName('齋藤 玲奈')).toBe(normalizeName('斉藤玲奈'));
    expect(normalizeName('渡邊 一郎')).toBe(normalizeName('渡辺一郎'));
    expect(normalizeName('山﨑 花子')).toBe(normalizeName('山崎花子'));
  });

  it('空白と記号を落とす', () => {
    expect(normalizeName(' 木村　花子 ')).toBe('木村花子');
    expect(normalizeName('木村・花子')).toBe('木村花子');
  });

  it('別人まで寄せない（読みや送り仮名は触らない）', () => {
    expect(normalizeName('高橋凛花')).not.toBe(normalizeName('高橋凛'));
    expect(normalizeName('高橋愛依')).not.toBe(normalizeName('高橋愛衣'));
  });
});

describe('suggestMatches の異体字対応', () => {
  it('会員が異体字で登録されていても漢字フォールバックで当たる', () => {
    const r = suggestMatches(
      [E(20, '高橋 凛花', 'タカハシ リン', { handleSelf: 'rin' })],
      [{ id: 5, hacomono_member_id: 'M005', full_name: '髙橋 凛花', full_name_kana: 'タカハシ リンカ', status: 'active', instagram_handle: null }]
    );
    expect(r[0].confidence).toBe('高');
    expect(r[0].candidates[0].reason).toBe('name');
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
