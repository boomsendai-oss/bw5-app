import { describe, it, expect } from 'vitest';
import {
  WAITLIST_CAPACITY,
  validateWaitlistInput,
  offerDeadlineHours,
  canJoinWaitlist,
} from '../bf6Waitlist';

describe('キャンセル待ちの受付可否', () => {
  it('満枠の部門だけ受け付ける(空きがあるなら通常エントリーへ)', () => {
    expect(canJoinWaitlist({ remaining: 0, waiting: 0 })).toBe('ok');
    expect(canJoinWaitlist({ remaining: 3, waiting: 0 })).toBe('not_full');
  });

  it('上限5名まで', () => {
    expect(WAITLIST_CAPACITY).toBe(5);
    expect(canJoinWaitlist({ remaining: 0, waiting: 4 })).toBe('ok');
    expect(canJoinWaitlist({ remaining: 0, waiting: 5 })).toBe('waitlist_full');
  });
});

describe('繰り上げの返答期限', () => {
  it('通常は48時間', () => {
    expect(offerDeadlineHours('2026-09-10')).toBe(48);
  });

  it('本番直前(9/24以降)は24時間に短縮する', () => {
    expect(offerDeadlineHours('2026-09-24')).toBe(24);
    expect(offerDeadlineHours('2026-09-25')).toBe(24);
  });
});

describe('入力の検証', () => {
  const base = {
    buyerName: '木村 花子', email: 'a@example.com', phone: '09012345678',
    dancerName: 'HANA', dancerKana: 'ハナ', performerName: '木村 花子',
    grade: 'es4', genre: 'HIPHOP', rep: '仙台', instagram: '',
  };

  it('正しい入力は通る', () => {
    expect(typeof validateWaitlistInput(base)).toBe('object');
  });

  it('メールが不正なら弾く(繰り上げ通知が届かないため)', () => {
    expect(validateWaitlistInput({ ...base, email: 'xxx' })).toBe('メールアドレスの形式が正しくありません');
  });

  it('フリガナはカタカナのみ', () => {
    expect(typeof validateWaitlistInput({ ...base, dancerKana: 'はな' })).toBe('string');
  });

  it('ダンサーネームは必須', () => {
    expect(typeof validateWaitlistInput({ ...base, dancerName: '' })).toBe('string');
  });
});
