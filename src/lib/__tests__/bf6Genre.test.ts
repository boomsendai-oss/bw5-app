import { describe, it, expect } from 'vitest';
import { ledGenre } from '../bf6Genre';

describe('LEDに出すジャンル表記', () => {
  it('大文字に揃える', () => {
    expect(ledGenre('hiphop')).toBe('HIPHOP');
    expect(ledGenre('popping')).toBe('POPPING');
  });

  it('同じ踊りの綴り違いを1つに揃える(ブレイキン)', () => {
    for (const s of ['BREAK', 'Break', 'Breaking', "breakin'", "BREAKIN'", 'ブレイキン']) {
      expect(ledGenre(s)).toBe("BREAKIN'");
    }
  });

  it('ヒップホップの空白ゆれを吸収する', () => {
    expect(ledGenre('HIP HOP')).toBe('HIPHOP');
    expect(ledGenre('hip-hop')).toBe('HIPHOP');
  });

  it('複数ジャンルはスラッシュ区切りに揃え、それぞれを直す', () => {
    expect(ledGenre('HIPHOP / HOUSE')).toBe('HIPHOP/HOUSE');
    expect(ledGenre('HOUSE/HIPHOP')).toBe('HOUSE/HIPHOP');
    expect(ledGenre('Waack/FreeStyle')).toBe('WAACK/FREESTYLE');
  });

  it('&でつないだものはそのまま(順番も勝手に変えない)', () => {
    expect(ledGenre('SOUL&WAACKING')).toBe('SOUL&WAACKING');
  });

  it('前後の空白を落とす', () => {
    expect(ledGenre('  LOCK  ')).toBe('LOCK');
  });

  it('空なら空(名前の下に何も出さない)', () => {
    expect(ledGenre('')).toBe('');
    expect(ledGenre('   ')).toBe('');
  });

  it('知らないジャンルは大文字にするだけで、勝手に別の言葉にしない', () => {
    expect(ledGenre('krump')).toBe('KRUMP');
    expect(ledGenre('ジャズ')).toBe('ジャズ');
  });
});
