import { describe, it, expect } from 'vitest';
import { normalizeReferral, REFERRAL_CHANNELS } from '../referralSource';

describe('normalizeReferral', () => {
  it('旧選択肢を正しい経路に寄せる', () => {
    expect(normalizeReferral('知り合いからのご紹介')).toBe('紹介');
    expect(normalizeReferral('googleなどのWEB検索')).toBe('ネット検索');
    expect(normalizeReferral('インスタグラム')).toBe('インスタ');
    expect(normalizeReferral('その他')).toBe('その他');
  });

  it('新選択肢も同じ経路に寄せる', () => {
    expect(normalizeReferral('ご紹介（お友だち・ご家族）')).toBe('紹介');
    expect(normalizeReferral('Google・ネット検索')).toBe('ネット検索');
    expect(normalizeReferral('Googleマップ')).toBe('マップ');
    expect(normalizeReferral('Instagram')).toBe('インスタ');
    expect(normalizeReferral('チラシ・看板')).toBe('チラシ・看板');
  });

  it('マップは検索より優先して判定する(Googleを両方含むため)', () => {
    expect(normalizeReferral('Googleマップを見て')).toBe('マップ');
  });

  it('未入力は未記入', () => {
    expect(normalizeReferral(null)).toBe('未記入');
    expect(normalizeReferral('')).toBe('未記入');
    expect(normalizeReferral('   ')).toBe('未記入');
  });

  it('知らない値はその他に倒す', () => {
    expect(normalizeReferral('通りすがり')).toBe('その他');
  });

  it('経路の一覧は表示順に並んでいる', () => {
    expect(REFERRAL_CHANNELS).toEqual([
      '紹介',
      'ネット検索',
      'マップ',
      'インスタ',
      'チラシ・看板',
      'その他',
      '未記入',
    ]);
  });
});
