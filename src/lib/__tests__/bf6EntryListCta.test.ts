import { describe, it, expect } from 'vitest';
import { entryListCta } from '../bf6Waitlist';

describe('エントリーリストに出すCTAの出し分け', () => {
  it('空きがあれば通常のエントリー導線', () => {
    const r = entryListCta({ division: 'kids', count: 18, capacity: 32, waiting: 0 });
    expect(r.kind).toBe('entry');
    expect(r.href).toBe('/bf6/entry');
  });

  it('満枠でキャンセル待ちに空きがあれば、その部門のキャンセル待ちへ誘導する', () => {
    const r = entryListCta({ division: 'beginner', count: 16, capacity: 16, waiting: 0 });
    expect(r.kind).toBe('waitlist');
    expect(r.href).toBe('/bf6/waitlist?d=beginner');
  });

  it('満枠でキャンセル待ちも上限なら、受付終了として導線を出さない', () => {
    const r = entryListCta({ division: 'beginner', count: 16, capacity: 16, waiting: 5 });
    expect(r.kind).toBe('waitlist_full');
    expect(r.href).toBeNull();
  });

  it('定員を超えて登録されていても満枠として扱う(データのゆらぎに耐える)', () => {
    const r = entryListCta({ division: 'beginner', count: 17, capacity: 16, waiting: 1 });
    expect(r.kind).toBe('waitlist');
  });

  it('定員0(未設定)のときは満枠扱いにせず通常導線のままにする', () => {
    const r = entryListCta({ division: 'general', count: 0, capacity: 0, waiting: 0 });
    expect(r.kind).toBe('entry');
  });
});

describe('満枠かどうかの表示', () => {
  it('満枠の部門だけ満枠バッジを出す', () => {
    expect(entryListCta({ division: 'beginner', count: 16, capacity: 16, waiting: 0 }).isFull).toBe(true);
    expect(entryListCta({ division: 'kids', count: 18, capacity: 32, waiting: 0 }).isFull).toBe(false);
  });
});
