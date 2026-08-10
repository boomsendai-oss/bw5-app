import { describe, expect, it } from 'vitest';
import { normalizeCastHandles, upsertCastLine } from '../reelCaption';

const CLASS_CAPTION = [
  'NEW JACK SWING ／ 日曜 14:00',
  '🕺講師：@occhan.88',
  '体験レッスンは無料。ご予約はプロフィールのリンクから。',
  '',
  '#仙台ダンススクール #ニュージャックスウィング',
].join('\n');

describe('normalizeCastHandles', () => {
  it('@ と区切り文字のゆれを吸収する', () => {
    expect(normalizeCastHandles(' @a, b、@c ')).toEqual(['a', 'b', 'c']);
  });
  it('空なら空配列', () => {
    expect(normalizeCastHandles(null)).toEqual([]);
  });
});

describe('upsertCastLine', () => {
  it('「体験…」の直前に空行付きで入る', () => {
    const out = upsertCastLine(CLASS_CAPTION, 'a b');
    expect(out).toContain('CAST : @a @b');
    const lines = out.split('\n');
    const cast = lines.findIndex((l) => l.startsWith('CAST : '));
    expect(lines[cast + 1]).toBe('体験レッスンは無料。ご予約はプロフィールのリンクから。');
    expect(lines[cast - 1]).toBe('');
  });

  it('二重に足さず、既存のCAST行を置き換える', () => {
    const once = upsertCastLine(CLASS_CAPTION, 'a');
    const twice = upsertCastLine(once, 'b c');
    expect(twice.match(/CAST : /g)).toHaveLength(1);
    expect(twice).toContain('CAST : @b @c');
    expect(twice).not.toContain('@a');
  });

  it('空を渡すとCAST行ごと消え、元の文面に戻る', () => {
    const once = upsertCastLine(CLASS_CAPTION, 'a b');
    expect(upsertCastLine(once, '')).toBe(CLASS_CAPTION);
  });

  it('「体験」行が無ければタグ行の直前に入る', () => {
    const cap = ['本文', '', '#タグ'].join('\n');
    expect(upsertCastLine(cap, 'a')).toBe(['本文', '', 'CAST : @a', '', '#タグ'].join('\n'));
  });

  it('置き場所が無ければ末尾に付く', () => {
    expect(upsertCastLine('本文だけ', 'a')).toBe('本文だけ\n\nCAST : @a');
  });

  it('発表会の正本文面でも「体験…」の直前に入る', () => {
    const stage = [
      '【BOOM WOP vol.5】Best Pals 🕺',
      '',
      '仙台のダンススクールBOOM「はじめてのヒップホップ」クラスによるステージナンバー。',
      '',
      '📍日曜 11:00〜12:00',
      '🕺講師：@takaryu_1203',
      '',
      '体験レッスンは無料。ご予約はプロフィールの公式LINEから',
      '',
      '#仙台ダンススクール',
    ].join('\n');
    const out = upsertCastLine(stage, '@kimidori_ @ayk_rm4735');
    expect(out).toContain('CAST : @kimidori_ @ayk_rm4735');
    expect(out.match(/\n\n体験/)).not.toBeNull();
  });
});
