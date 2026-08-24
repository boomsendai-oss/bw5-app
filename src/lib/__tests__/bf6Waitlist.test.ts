import { describe, it, expect } from 'vitest';
import {
  WAITLIST_CAPACITY,
  validateWaitlistInput,
  offerDeadlineHours,
  canJoinWaitlist,
  isOfferActionable,
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

describe('繰り上げリンクの受理判定', () => {
  const now = '2026-09-10T12:00:00.000Z';

  it('期限内で offered なら操作できる', () => {
    expect(isOfferActionable({ status: 'offered', offerExpiresAt: '2026-09-12T12:00:00.000Z' }, now))
      .toBe('ok');
  });

  it('期限を過ぎていたら受け付けない', () => {
    expect(isOfferActionable({ status: 'offered', offerExpiresAt: '2026-09-09T12:00:00.000Z' }, now))
      .toBe('expired');
  });

  it('まだ繰り上げ通知が出ていない人のリンクは無効', () => {
    expect(isOfferActionable({ status: 'waiting', offerExpiresAt: null }, now)).toBe('not_offered');
  });

  it('すでに承諾/辞退が済んでいたら二度は受け付けない', () => {
    expect(isOfferActionable({ status: 'accepted', offerExpiresAt: '2026-09-12T12:00:00.000Z' }, now))
      .toBe('already_done');
    expect(isOfferActionable({ status: 'declined', offerExpiresAt: '2026-09-12T12:00:00.000Z' }, now))
      .toBe('already_done');
  });
});

describe('繰り上げ通知メール', () => {
  const row = {
    id: 1, division: 'beginner', position: 1, status: 'offered',
    dancerName: 'HANA', performerName: '木村 花子', grade: 'es4', rep: '仙台',
    email: 'a@example.com', phone: '090', buyerName: '木村 花子',
    offerExpiresAt: null, token: 'TOKEN123', createdAt: '',
  };

  it('承諾と辞退の両方のリンクが入る', async () => {
    const { buildWaitlistOfferEmail } = await import('../bf6WaitlistEmail');
    const { text } = buildWaitlistOfferEmail(row, '9月12日(土) 18:00');
    expect(text).toContain('a=yes');
    expect(text).toContain('a=no');
    expect(text).toContain('TOKEN123');
  });

  it('当日現金払いであることを明記する(先に預からない)', async () => {
    const { buildWaitlistOfferEmail } = await import('../bf6WaitlistEmail');
    const { text } = buildWaitlistOfferEmail(row, '9月12日(土) 18:00');
    expect(text).toContain('当日、会場受付で現金');
    expect(text).toContain('事前のお支払いは不要');
  });

  it('登録控えには「まだ確定していない」と書く', async () => {
    const { buildWaitlistJoinedEmail } = await import('../bf6WaitlistEmail');
    const { text } = buildWaitlistJoinedEmail(row, 2);
    expect(text).toContain('出場は確定していません');
    expect(text).toContain('2 名お待ち');
  });
});
