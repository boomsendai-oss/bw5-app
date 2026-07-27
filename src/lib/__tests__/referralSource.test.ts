import { describe, it, expect } from 'vitest';
import { normalizeReferral, REFERRAL_CHANNELS } from '../referralSource';

describe('normalizeReferral', () => {
  it('旧選択肢を正しい経路に寄せる', () => {
    expect(normalizeReferral('知り合いからのご紹介')).toBe('紹介');
    expect(normalizeReferral('googleなどのWEB検索')).toBe('ネット検索・マップ');
    expect(normalizeReferral('インスタグラム')).toBe('インスタ');
    expect(normalizeReferral('その他')).toBe('その他');
  });

  it('新選択肢も同じ経路に寄せる', () => {
    expect(normalizeReferral('ご紹介（お友だち・ご家族）')).toBe('紹介');
    expect(normalizeReferral('Instagram')).toBe('インスタ');
    expect(normalizeReferral('ネット検索・Googleマップ')).toBe('ネット検索・マップ');
    expect(normalizeReferral('チラシ・看板・のぼり')).toBe('チラシ・看板');
    expect(normalizeReferral('その他')).toBe('その他');
  });

  it('旧「マップ」扱いだった値もネット検索・マップに統合される', () => {
    expect(normalizeReferral('Googleマップ')).toBe('ネット検索・マップ');
    expect(normalizeReferral('Googleマップを見て')).toBe('ネット検索・マップ');
  });

  it('未入力は未記入', () => {
    expect(normalizeReferral(null)).toBe('未記入');
    expect(normalizeReferral('')).toBe('未記入');
    expect(normalizeReferral('   ')).toBe('未記入');
  });

  it('知らない値はその他に倒す', () => {
    expect(normalizeReferral('通りすがり')).toBe('その他');
  });

  it('インスタの単語境界は「ig」を含む別単語に誤マッチしない', () => {
    expect(normalizeReferral('design検索で見つけた')).toBe('ネット検索・マップ');
  });

  it('経路の一覧は表示順に並んでいる', () => {
    expect(REFERRAL_CHANNELS).toEqual([
      '紹介',
      'ネット検索・マップ',
      'インスタ',
      'X',
      'チラシ・看板',
      'その他',
      '未記入',
    ]);
  });

  it('X(旧Twitter)を正しく判定する', () => {
    expect(normalizeReferral('X（旧Twitter）')).toBe('X');
    expect(normalizeReferral('X (旧 twitter)')).toBe('X'); // Lstepに現存する表記
    expect(normalizeReferral('Twitter')).toBe('X');
    expect(normalizeReferral('ツイッター')).toBe('X');
    expect(normalizeReferral('X')).toBe('X');
  });

  it('Xの誤マッチ回帰: 英字1文字のxを含むだけの語はXにならない', () => {
    expect(normalizeReferral('Xperia')).toBe('その他');
    expect(normalizeReferral('boxで見た')).toBe('その他');
    expect(normalizeReferral('Instagram')).toBe('インスタ');
  });

  it('Xは検索系より優先される(単独語として現れる場合)', () => {
    expect(normalizeReferral('Xで検索して')).toBe('X');
  });
});
