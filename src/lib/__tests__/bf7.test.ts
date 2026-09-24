import { describe, it, expect } from 'vitest';
import { validateBf7Notify, buildBf7NotifyEmail, countdownTo, BF7_ENTRY_OPEN_AT } from '../bf7';

describe('validateBf7Notify', () => {
  it('名前とメールがあれば通る(部門は任意)', () => {
    const v = validateBf7Notify({ name: ' 山田 太郎 ', email: ' a@b.com ', divisions: [] });
    expect(v).toEqual({ name: '山田 太郎', email: 'a@b.com', divisions: [], note: '' });
  });

  it('名前が無ければエラー', () => {
    expect(validateBf7Notify({ name: '', email: 'a@b.com', divisions: [] })).toContain('お名前');
  });

  it('メールの形式が違えばエラー', () => {
    expect(validateBf7Notify({ name: 'A', email: 'bad', divisions: [] })).toContain('メールアドレス');
  });

  it('知らない部門は捨てる(投稿を書き換えられても壊れない)', () => {
    const v = validateBf7Notify({ name: 'A', email: 'a@b.com', divisions: ['kids', 'pro'] });
    expect(typeof v === 'string' ? [] : v.divisions).toEqual(['kids']);
  });
});

describe('buildBf7NotifyEmail', () => {
  it('部門は「希望」で開催の確約ではないと必ず書く', () => {
    const m = buildBf7NotifyEmail({ name: 'A', email: 'a@b.com', divisions: ['beginner'], note: '' });
    expect(m.text).toContain('開催されない場合があります');
    expect(m.text).toContain('2027年1月30日(土)');
    expect(m.text).toContain('ビギナー');
  });

  it('部門が未選択でも本文が壊れない', () => {
    const m = buildBf7NotifyEmail({ name: 'A', email: 'a@b.com', divisions: [], note: '' });
    expect(m.text).toContain('未選択');
  });
});

describe('countdownTo', () => {
  it('残り時間を日・時・分・秒に割る', () => {
    const now = new Date('2026-11-28T00:00:00+09:00');
    expect(countdownTo(BF7_ENTRY_OPEN_AT, now)).toEqual({ done: false, days: 2, hours: 0, minutes: 0, seconds: 0 });
  });

  it('過ぎていたら done', () => {
    expect(countdownTo(BF7_ENTRY_OPEN_AT, new Date('2026-12-01T00:00:00+09:00')).done).toBe(true);
  });
});
