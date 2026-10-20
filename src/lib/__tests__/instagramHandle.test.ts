import { describe, it, expect } from 'vitest';
import { normalizeInstagramHandle, isValidInstagramHandle, validateBf6Order } from '../bf6';

describe('Instagramアカウント名の正規化', () => {
  it('@の有無・空白・URL貼り付けを吸収する', () => {
    expect(normalizeInstagramHandle('kousukekokeko')).toBe('@kousukekokeko');
    expect(normalizeInstagramHandle('@ luv_.riko')).toBe('@luv_.riko');
    expect(normalizeInstagramHandle('@sssoraaa __yan')).toBe('@sssoraaa__yan');
    expect(normalizeInstagramHandle('https://www.instagram.com/maia_honu/?hl=ja')).toBe('@maia_honu');
    expect(normalizeInstagramHandle('＠yuiman15')).toBe('@yuiman15');
    expect(normalizeInstagramHandle('   ')).toBe('');
  });
});

describe('Instagramで使える形か', () => {
  it('半角英数字・ピリオド・アンダーバーだけならOK', () => {
    expect(isValidInstagramHandle('@bboy_hey.hey.ryohey')).toBe(true);
    expect(isValidInstagramHandle('@LEA413785')).toBe(true);
  });
  it('vol.6で実際にタグ付けできなかった形は弾く', () => {
    expect(isValidInstagramHandle('@b-boy_am_0918')).toBe(false); // ハイフン
    expect(isValidInstagramHandle('@nodoka—-1002')).toBe(false); // 全角ダッシュ
  });
  it('31文字以上は弾く', () => {
    expect(isValidInstagramHandle('@' + 'a'.repeat(31))).toBe(false);
  });
});

describe('エントリーの検証でInstagramの打ち間違いを止める', () => {
  const base = {
    buyerName: '申込 太郎', email: 'a@example.com', phone: '09012345678', payMethod: 'prepaid',
    adultTickets: 0, childTickets: 0,
  };
  const entry = (instagram: string) => ({
    performerName: 'テスト', dancerName: 'AM', dancerKana: 'エーエム', grade: 'adult',
    genre: 'BREAK', rep: '仙台', instagram, divisions: ['general'],
  });
  it('使えない文字があればエラーで止める', () => {
    const r = validateBf6Order({ ...base, entries: [entry('@b-boy_am_0918')] });
    expect(typeof r).toBe('string');
    expect(r as string).toContain('使えない文字');
  });
  it('空白入りは直して通す', () => {
    const r = validateBf6Order({ ...base, entries: [entry('@ bboy_am_0918')] });
    expect(typeof r).not.toBe('string');
    if (typeof r !== 'string') expect(r.entries[0].instagram).toBe('@bboy_am_0918');
  });
  it('空欄は任意なので通す', () => {
    const r = validateBf6Order({ ...base, entries: [entry('')] });
    expect(typeof r).not.toBe('string');
  });
});
