import { describe, it, expect } from 'vitest';
import { displayedEntryCount, entryListCta } from '../bf6Waitlist';

describe('タブに出す人数(キャンセル待ちを含める)', () => {
  it('キャンセル待ちがいれば定員を超えた数字になる(人気が伝わるように)', () => {
    expect(displayedEntryCount({ entryCount: 16, waitingCount: 1 })).toBe(17);
  });

  it('キャンセル待ちが0なら本体の人数のまま', () => {
    expect(displayedEntryCount({ entryCount: 21, waitingCount: 0 })).toBe(21);
  });

  it('キャンセル待ちが複数いれば全員ぶん足す', () => {
    expect(displayedEntryCount({ entryCount: 16, waitingCount: 5 })).toBe(21);
  });
});

describe('表示人数を増やしても満枠判定とCTAは本体の人数で決める', () => {
  it('本体が定員未満なら、キャンセル待ちの数を足して定員を超えても通常のエントリー導線のまま', () => {
    // ありえない状況だが、表示用の数字を判定に混ぜてしまう実装だと満枠になってしまう
    const r = entryListCta({ division: 'kids', count: 30, capacity: 32, waiting: 5 });
    expect(r.kind).toBe('entry');
    expect(r.isFull).toBe(false);
  });

  it('本体が満枠ならキャンセル待ち導線になる', () => {
    const r = entryListCta({ division: 'beginner', count: 16, capacity: 16, waiting: 1 });
    expect(r.kind).toBe('waitlist');
    expect(r.isFull).toBe(true);
  });
});
