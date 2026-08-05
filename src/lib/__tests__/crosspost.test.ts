import { describe, it, expect } from 'vitest';
import {
  splitCaption,
  buildXText,
  buildYouTubeMeta,
  sanitizeHandlesForOtherPlatform,
  pickNext,
  X_TEXT_MAX,
  THREADS_TEXT_MAX,
  TIKTOK_TITLE_MAX,
  buildTikTokTitle,
  buildFacebookDescription,
  buildThreadsText,
  YT_TITLE_MAX,
  MAX_ATTEMPTS,
  YT_DESCRIPTION_MAX,
  buildXReplyCta,
  classifyByEnabled,
  type CrosspostRow,
} from '../crosspost';
import { OFFICIAL_LINE_URL, WEBSITE_URL } from '../links';

describe('splitCaption', () => {
  it('末尾のハッシュタグ行を本文から切り離す', () => {
    const { body, tags } = splitCaption(
      'かっこよくHIPHOPを踊りたい方へ。\n体験は無料です。\n\n#仙台ダンス #キッズダンス'
    );
    expect(body).toBe('かっこよくHIPHOPを踊りたい方へ。\n体験は無料です。');
    expect(tags).toEqual(['#仙台ダンス', '#キッズダンス']);
  });

  it('タグが複数行に分かれていても全部拾う', () => {
    const { body, tags } = splitCaption('本文\n\n#a #b\n#c');
    expect(body).toBe('本文');
    expect(tags).toEqual(['#a', '#b', '#c']);
  });

  it('本文中の # は切り離さない(末尾の塊だけが対象)', () => {
    const { body, tags } = splitCaption('#1 の練習方法について\n\n#仙台');
    expect(body).toBe('#1 の練習方法について');
    expect(tags).toEqual(['#仙台']);
  });

  it('タグが無くても壊れない', () => {
    expect(splitCaption('本文だけ')).toEqual({ body: '本文だけ', tags: [] });
    expect(splitCaption('')).toEqual({ body: '', tags: [] });
  });
});

describe('buildXText', () => {
  it('本文とタグを280文字以内に収める', () => {
    const out = buildXText('短い本文です。\n\n#仙台ダンス #キッズダンス #HIPHOP #ストリートダンス');
    expect([...out].length).toBeLessThanOrEqual(X_TEXT_MAX);
    expect(out).toContain('短い本文です。');
    expect(out).toContain('#仙台ダンス');
  });

  it('タグは既定で3つまで(盛りすぎない)', () => {
    const out = buildXText('本文\n\n#a #b #c #d #e');
    expect(out).toContain('#a');
    expect(out).toContain('#c');
    expect(out).not.toContain('#d');
  });

  it('本文が長いときはタグを足さずに本文を優先する', () => {
    const long = 'あ'.repeat(300);
    const out = buildXText(`${long}\n\n#タグ`);
    expect([...out].length).toBeLessThanOrEqual(X_TEXT_MAX);
    expect(out).not.toContain('#タグ');
  });

  it('上限ちょうどでも超えない', () => {
    const body = 'い'.repeat(275);
    const out = buildXText(`${body}\n\n#あいうえお`);
    expect([...out].length).toBeLessThanOrEqual(X_TEXT_MAX);
  });
});

describe('buildYouTubeMeta', () => {
  it('【】見出しをタイトルにする', () => {
    const m = buildYouTubeMeta('fallback', '【BOOM WOP vol.5】Sunshine 🕺\n本文です。\n\n#仙台ダンス');
    expect(m.title).toBe('BOOM WOP vol.5 Sunshine 🕺');
  });

  it('【】が無ければ1行目をタイトルにする', () => {
    const m = buildYouTubeMeta('fallback', 'かっこよく踊りたい方へ\n2行目\n\n#a');
    expect(m.title).toBe('かっこよく踊りたい方へ');
  });

  it('キャプションが空なら渡されたタイトルを使う', () => {
    expect(buildYouTubeMeta('リールのタイトル', '').title).toBe('リールのタイトル');
  });

  it('説明に #Shorts を必ず入れる', () => {
    const m = buildYouTubeMeta('t', '本文\n\n#仙台ダンス');
    expect(m.description).toContain('#Shorts');
    expect(m.description).toContain('#仙台ダンス');
  });

  it('#Shorts を重複させない', () => {
    const m = buildYouTubeMeta('t', '本文\n\n#Shorts #仙台');
    expect(m.description.match(/#Shorts/g)).toHaveLength(1);
  });

  it('tagsフィールドからは # を外す', () => {
    const m = buildYouTubeMeta('t', '本文\n\n#仙台ダンス #キッズ');
    expect(m.tags).toEqual(['仙台ダンス', 'キッズ']);
  });

  it('公式LINEのURLを必ず入れる(YouTubeは説明のリンクが押せる)', () => {
    const m = buildYouTubeMeta('t', '本文\n\n#仙台ダンス');
    expect(m.description).toContain(OFFICIAL_LINE_URL);
  });

  it('ホームページのURLも入れる', () => {
    const m = buildYouTubeMeta('t', '本文');
    expect(m.description).toContain(WEBSITE_URL);
  });

  it('Instagram向けの「プロフィール」をYouTubeの「概要欄」に言い換える', () => {
    const m = buildYouTubeMeta('t', '体験レッスンは無料。ご予約はプロフィールの公式LINEから');
    expect(m.description).toContain('概要欄');
    expect(m.description).not.toContain('プロフィール');
  });

  it('本文が極端に長くても導線は削られない', () => {
    const m = buildYouTubeMeta('t', 'あ'.repeat(8000) + '\n\n#仙台ダンス');
    expect([...m.description].length).toBeLessThanOrEqual(YT_DESCRIPTION_MAX);
    expect(m.description).toContain(OFFICIAL_LINE_URL);
    expect(m.description).toContain('#Shorts');
  });

  it('導線はハッシュタグより前に置く(タグに埋もれさせない)', () => {
    const m = buildYouTubeMeta('t', '本文\n\n#仙台ダンス');
    expect(m.description.indexOf(OFFICIAL_LINE_URL)).toBeLessThan(
      m.description.indexOf('#仙台ダンス')
    );
  });

  it('タイトルは100文字を超えない', () => {
    const m = buildYouTubeMeta('t', 'あ'.repeat(200));
    expect([...m.title].length).toBeLessThanOrEqual(YT_TITLE_MAX);
  });
});

describe('pickNext', () => {
  const row = (o: Partial<Parameters<typeof pickNext>[0][number]>) => ({
    id: 1,
    reel_id: 1,
    platform: 'youtube',
    status: 'pending',
    attempts: 0,
    ...o,
  });

  it('pending を failed より優先する', () => {
    const got = pickNext([
      row({ id: 1, status: 'failed', attempts: 1 }),
      row({ id: 2, status: 'pending' }),
    ]);
    expect(got?.id).toBe(2);
  });

  it('試行回数を使い切った failed は選ばない', () => {
    expect(pickNext([row({ status: 'failed', attempts: MAX_ATTEMPTS })])).toBeNull();
  });

  it('posted / posting / skipped は選ばない', () => {
    expect(
      pickNext([row({ status: 'posted' }), row({ status: 'posting' }), row({ status: 'skipped' })])
    ).toBeNull();
  });

  it('failed 同士なら試行回数の少ない方を選ぶ', () => {
    const got = pickNext([
      row({ id: 1, status: 'failed', attempts: 2 }),
      row({ id: 2, status: 'failed', attempts: 1 }),
    ]);
    expect(got?.id).toBe(2);
  });

  it('対象が無ければ null', () => {
    expect(pickNext([])).toBeNull();
  });

  it('同条件なら新しいリール(reel_id が大きい方)を先に出す', () => {
    const got = pickNext([
      row({ id: 1, reel_id: 1 }),
      row({ id: 2, reel_id: 7 }),
      row({ id: 3, reel_id: 4 }),
    ]);
    expect(got?.reel_id).toBe(7);
  });

  it('同じリール内では配信先の順序が安定している(id昇順)', () => {
    const got = pickNext([
      row({ id: 9, reel_id: 7, platform: 'x' }),
      row({ id: 8, reel_id: 7, platform: 'youtube' }),
    ]);
    expect(got?.id).toBe(8);
  });
});

describe('buildXReplyCta', () => {
  it('公式LINEのURLを含む', () => {
    expect(buildXReplyCta()).toContain(OFFICIAL_LINE_URL);
  });

  it('280文字に収まる', () => {
    expect([...buildXReplyCta()].length).toBeLessThanOrEqual(X_TEXT_MAX);
  });

  it('何をするリンクなのかが分かる文言を添える', () => {
    expect(buildXReplyCta()).toContain('体験');
  });
});

describe('classifyByEnabled', () => {
  const row = (o: Partial<CrosspostRow>): CrosspostRow => ({
    id: 1,
    reel_id: 1,
    platform: 'youtube',
    status: 'pending',
    attempts: 0,
    ...o,
  });

  it('envが未設定のプラットフォームの行は skip 対象になる', () => {
    const r = row({ id: 1, platform: 'youtube', status: 'pending' });
    const out = classifyByEnabled([r], new Set(['x']));
    expect(out.toSkip.map((x) => x.id)).toEqual([1]);
    expect(out.actionable).toEqual([]);
  });

  it('すでに skipped の行は再度 skip しない(無駄な更新を打たない)', () => {
    const r = row({ id: 1, platform: 'youtube', status: 'skipped' });
    expect(classifyByEnabled([r], new Set(['x'])).toSkip).toEqual([]);
  });

  it('envが入ったプラットフォームの skipped は復活対象になる', () => {
    const r = row({ id: 1, platform: 'youtube', status: 'skipped', attempts: 2 });
    const out = classifyByEnabled([r], new Set(['youtube']));
    expect(out.toRevive.map((x) => x.id)).toEqual([1]);
    // 復活直後は actionable に含めない(DB更新後の次回実行で拾う)
    expect(out.actionable).toEqual([]);
  });

  it('enabled かつ pending/failed はそのまま処理対象', () => {
    const rows = [
      row({ id: 1, platform: 'x', status: 'pending' }),
      row({ id: 2, platform: 'x', status: 'failed', attempts: 1 }),
    ];
    const out = classifyByEnabled(rows, new Set(['x']));
    expect(out.actionable.map((x) => x.id)).toEqual([1, 2]);
    expect(out.toSkip).toEqual([]);
    expect(out.toRevive).toEqual([]);
  });
});

// Instagram向けキャプションの @ハンドルを、X/YouTube に流す前に無害化する。
// ここが抜けると、同名のX/YouTubeアカウントを持つ**赤の他人**に通知が飛ぶ(TARO 2026-08-05)。
const NAMES = {
  m55keiko: 'KEIKO',
  takaryu_1203: 'Ryuki',
  taro_bsb: 'TARO',
  kattsu_ziel: 'K@TTSU',
};

describe('sanitizeHandlesForOtherPlatform', () => {
  it('講師のInstagramハンドルを名前に置き換える(@を残さない)', () => {
    const out = sanitizeHandlesForOtherPlatform('🕺講師：@takaryu_1203', NAMES);
    expect(out).toBe('🕺講師：Ryuki');
    expect(out).not.toContain('@');
  });

  it('CAST行(生徒のハンドル)は行ごと落とす', () => {
    const caption = [
      '【BOOM WOP vol.5】Sunshine 🕺', '', '🕺講師：@taro_bsb', '',
      'CAST : @kid_a @kid_b', '', '体験レッスンは無料。',
    ].join('\n');
    const out = sanitizeHandlesForOtherPlatform(caption, NAMES);
    expect(out).not.toContain('CAST');
    expect(out).not.toContain('kid_a');
    expect(out).toContain('🕺講師：TARO');
  });

  it('旧表記の「出演：」も落とす', () => {
    expect(sanitizeHandlesForOtherPlatform('出演：@testuser1 @testuser2', NAMES)).toBe('');
  });

  it('登録簿に無いハンドルは名前が付けられないので行ごと落とす', () => {
    // 間違ったアカウントへのリンクを作るより、講師行が無いほうがまし
    expect(sanitizeHandlesForOtherPlatform('🕺講師：@unknown_person', NAMES)).toBe('');
  });

  it('曜日と講師が1行に同居していても壊さない(旧フォーマットのリール)', () => {
    const out = sanitizeHandlesForOtherPlatform('📍水曜 18:30〜20:00 / 講師：@taro_bsb', NAMES);
    expect(out).toBe('📍水曜 18:30〜20:00 / 講師：TARO');
  });

  it('行を落とした跡に空行が3つ以上並ばない', () => {
    expect(sanitizeHandlesForOtherPlatform('本文\n\nCAST : @a\n\n締め', NAMES)).toBe('本文\n\n締め');
  });

  it('@が無いキャプションはそのまま', () => {
    const caption = 'HIPHOP ／ 日曜 14:00\n体験レッスンは無料。';
    expect(sanitizeHandlesForOtherPlatform(caption, NAMES)).toBe(caption);
  });
});

describe('X / YouTube の本文に Instagram のハンドルが残らない', () => {
  const caption = [
    '【BOOM WOP vol.5】Sunshine 🕺', '',
    '仙台のダンススクールBOOM「TARO HIPHOP 初級」クラスによるステージナンバー。', '',
    '📍水曜 18:30〜20:00', '🕺講師：@taro_bsb', '',
    'CAST : @kid_a @kid_b', '',
    '体験レッスンは無料。ご予約はプロフィールの公式LINEから', '',
    '#仙台ダンススクール #ダンススクール',
  ].join('\n');

  it('X本文', () => {
    const x = buildXText(sanitizeHandlesForOtherPlatform(caption, NAMES));
    expect(x).not.toMatch(/@[A-Za-z0-9._]/);
    expect(x).toContain('🕺講師：TARO');
  });

  it('YouTube説明', () => {
    const yt = buildYouTubeMeta('Sunshine', sanitizeHandlesForOtherPlatform(caption, NAMES));
    expect(yt.description).not.toMatch(/@[A-Za-z0-9._]/);
    expect(yt.description).toContain('🕺講師：TARO');
  });
});

describe('buildXText のX向け言い換え', () => {
  // Xの導線は本体でなくリプライにある(buildXReplyCta)。「プロフィール」では辿り着けない
  it('「プロフィール」を「リプライ欄」に言い換える', () => {
    const out = buildXText('体験レッスンは無料。ご予約はプロフィールの公式LINEから');
    expect(out).toContain('リプライ欄の公式LINEから');
    expect(out).not.toContain('プロフィール');
  });

  it('「プロフィールのリンク（公式LINE）」の形も置き換わる', () => {
    const out = buildXText('ご予約はプロフィールのリンク（公式LINE）から。');
    expect(out).toBe('ご予約はリプライ欄のリンク（公式LINE）から。');
  });

  it('「プロフィール」が無い本文は変えない', () => {
    expect(buildXText('HIPHOP ／ 日曜 14:00')).toBe('HIPHOP ／ 日曜 14:00');
  });
});

describe('buildThreadsText', () => {
  const caption = [
    '【BOOM WOP vol.5】Sunshine 🕺', '',
    '仙台のダンススクールBOOM「TARO HIPHOP 初級」クラスによるステージナンバー。', '',
    '📍水曜 18:30〜20:00', '🕺講師：TARO', '',
    '体験レッスンは無料。ご予約はプロフィールの公式LINEから', '',
    '#仙台ダンススクール #ダンススクール #ストリートダンス',
  ].join('\n');

  it('公式LINEのURLを本文に入れる(Threadsはリンクを入れても表示が落ちない)', () => {
    expect(buildThreadsText(caption)).toContain(OFFICIAL_LINE_URL);
  });

  it('Instagram前提の「プロフィールから」は残さない', () => {
    expect(buildThreadsText(caption)).not.toContain('プロフィール');
  });

  it('タグは1つだけ(Threadsは複数付けてもリンクにならない)', () => {
    const out = buildThreadsText(caption);
    expect(out).toContain('#仙台ダンススクール');
    expect(out).not.toContain('#ダンススクール ');
    expect(out.match(/#/g)).toHaveLength(1);
  });

  it('500文字を超えない', () => {
    const out = buildThreadsText('あ'.repeat(2000) + '\n\n#タグ');
    expect([...out].length).toBeLessThanOrEqual(THREADS_TEXT_MAX);
    expect(out).toContain(OFFICIAL_LINE_URL);
  });

  it('本文が長くても導線は削られない', () => {
    const out = buildThreadsText('い'.repeat(600));
    expect(out).toContain(OFFICIAL_LINE_URL);
  });
});

describe('buildTikTokTitle', () => {
  // TikTokはプロフィールにリンクを置けるので「プロフィールから」はそのまま通じる
  it('「プロフィール」を言い換えない', () => {
    const out = buildTikTokTitle('ご予約はプロフィールのリンクから。\n\n#仙台ダンス');
    expect(out).toContain('プロフィールのリンクから');
  });

  it('タグは全部残す(Xと違って本文が短いので削る必要がない)', () => {
    const out = buildTikTokTitle('本文\n\n#a #b #c #d #e');
    expect(out).toContain('#e');
  });

  it('2200文字を超えない', () => {
    const out = buildTikTokTitle('あ'.repeat(3000) + '\n\n#タグ');
    expect([...out].length).toBeLessThanOrEqual(TIKTOK_TITLE_MAX);
  });
});

describe('buildFacebookDescription', () => {
  it('Instagram前提の「プロフィール」を「ページ」に言い換える', () => {
    const out = buildFacebookDescription('ご予約はプロフィールの公式LINEから\n\n#仙台ダンス');
    expect(out).toContain('ページの公式LINEから');
    expect(out).not.toContain('プロフィール');
  });

  it('公式LINEのURLとタグを入れる', () => {
    const out = buildFacebookDescription('本文\n\n#仙台ダンス #キッズダンス');
    expect(out).toContain(OFFICIAL_LINE_URL);
    expect(out).toContain('#キッズダンス');
  });
});
