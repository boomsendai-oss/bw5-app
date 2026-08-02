import { describe, it, expect } from 'vitest';
import {
  splitCaption,
  buildXText,
  buildYouTubeMeta,
  pickNext,
  X_TEXT_MAX,
  YT_TITLE_MAX,
  MAX_ATTEMPTS,
} from '../crosspost';

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
});
