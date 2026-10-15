import { describe, it, expect } from 'vitest';
import { makeAudioTicket, verifyAudioTicket } from '../partyAudioTicket';

describe('音源アップロードの通行証', () => {
  it('作った申込IDに戻る・改ざんや期限切れは無効', () => {
    const t = makeAudioTicket(12, 1_000_000_000_000);
    expect(verifyAudioTicket(t, 1_000_000_000_000)).toBe(12);
    expect(verifyAudioTicket(t.replace(/^12\./, '13.'), 1_000_000_000_000)).toBeNull();
    expect(verifyAudioTicket(t, 1_000_000_000_000 + 61 * 60 * 1000)).toBeNull();
    expect(verifyAudioTicket('abc', 1_000_000_000_000)).toBeNull();
  });
});
