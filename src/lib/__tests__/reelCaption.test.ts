import { describe, expect, it } from 'vitest';
import { normalizeCastHandles, upsertCastLine } from '../reelCaption';

// クラスリールの実文面(「体験…」の前に空行が無い型)
const CLASS_CAPTION = [
  'NEW JACK SWING ／ 日曜 14:00',
  '🕺講師：@occhan.88',
  '体験レッスンは無料。ご予約はプロフィールのリンクから。',
  '',
  '#仙台ダンススクール #ニュージャックスウィング',
].join('\n');

// 発表会リールの正本文面(「体験…」の前に空行がある型)
const STAGE_CAPTION = [
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

describe('normalizeCastHandles', () => {
  it('@ と区切り文字のゆれを吸収する', () => {
    expect(normalizeCastHandles(' @a, b、@c ')).toEqual(['a', 'b', 'c']);
  });
  it('空なら空配列', () => {
    expect(normalizeCastHandles(null)).toEqual([]);
  });
});

describe('upsertCastLine', () => {
  it('クラス文面: CAST行が上下を空行で挟まれて「体験…」の直前に入る', () => {
    expect(upsertCastLine(CLASS_CAPTION, 'a b')).toBe(
      [
        'NEW JACK SWING ／ 日曜 14:00',
        '🕺講師：@occhan.88',
        '',
        'CAST : @a @b',
        '',
        '体験レッスンは無料。ご予約はプロフィールのリンクから。',
        '',
        '#仙台ダンススクール #ニュージャックスウィング',
      ].join('\n')
    );
  });

  it('発表会文面: 元からある空行を飲み込み、空行が二重にならない', () => {
    const out = upsertCastLine(STAGE_CAPTION, 'x');
    expect(out).toContain('🕺講師：@takaryu_1203\n\nCAST : @x\n\n体験レッスンは無料');
    expect(out).not.toContain('\n\n\n');
  });

  it('入れ直しても二重にならず、空行も増えない', () => {
    let out = upsertCastLine(CLASS_CAPTION, 'a');
    for (const h of ['b', 'c d', 'e']) out = upsertCastLine(out, h);
    expect(out.match(/CAST : /g)).toHaveLength(1);
    expect(out).toContain('CAST : @e');
    expect(out).not.toContain('\n\n\n');
  });

  it('発表会文面は、空にすると元どおりに戻る', () => {
    expect(upsertCastLine(upsertCastLine(STAGE_CAPTION, 'a b'), '')).toBe(STAGE_CAPTION);
  });

  // クラス文面は元々「体験…」の前に空行が無いので、外すと空行1つに整う(=発表会と同じ形)。
  // 完全復元ではないが、CASTは消えるし空行も増え続けない。
  it('クラス文面は、空にするとCASTが消えて空行1つに整う', () => {
    const removed = upsertCastLine(upsertCastLine(CLASS_CAPTION, 'a b'), '');
    expect(removed).not.toContain('CAST');
    expect(removed).not.toContain('\n\n\n');
    expect(removed).toBe(
      [
        'NEW JACK SWING ／ 日曜 14:00',
        '🕺講師：@occhan.88',
        '',
        '体験レッスンは無料。ご予約はプロフィールのリンクから。',
        '',
        '#仙台ダンススクール #ニュージャックスウィング',
      ].join('\n')
    );
    // 何度出し入れしても同じ形に収束する(空行が増えない)
    expect(upsertCastLine(upsertCastLine(removed, 'z'), '')).toBe(removed);
  });

  it('「体験」行が無ければタグ行の直前に入る', () => {
    expect(upsertCastLine(['本文', '', '#タグ'].join('\n'), 'a')).toBe(
      ['本文', '', 'CAST : @a', '', '#タグ'].join('\n')
    );
  });

  it('置き場所が無ければ末尾に付く', () => {
    expect(upsertCastLine('本文だけ', 'a')).toBe('本文だけ\n\nCAST : @a');
  });
});
