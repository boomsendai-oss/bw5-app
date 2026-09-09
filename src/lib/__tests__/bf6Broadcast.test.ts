import { describe, it, expect } from 'vitest';
import { buildBf6Broadcast, BF6_BROADCAST_TEMPLATES } from '../bf6Broadcast';

describe('BF6 一斉メールのテンプレート', () => {
  it('集合時刻の案内テンプレートが存在する', () => {
    const t = BF6_BROADCAST_TEMPLATES.find((x) => x.key === 'call-time-1');
    expect(t).toBeTruthy();
  });

  it('件名にバトルエントリー者向けであることが分かる', () => {
    const { subject } = buildBf6Broadcast('call-time-1');
    expect(subject).toContain('13:30');
    expect(subject).toContain('バトルエントリー者');
  });

  it('本文に集合時刻・締切・抽選の説明が入る', () => {
    const { body } = buildBf6Broadcast('call-time-1');
    expect(body).toContain('13:30 集合');
    expect(body).toContain('14:00 締切');
    expect(body).toContain('組み合わせ抽選');
    expect(body).toContain('運営サイドで決定を行う場合があります');
  });

  it('本文に受付で渡すもの・観覧の案内・当日の流れが入る', () => {
    const { body } = buildBf6Broadcast('call-time-1');
    expect(body).toContain('リストバンド');
    expect(body).toContain('当日現金');
    expect(body).toContain('14:30');
    expect(body).toContain('https://boomersfight.vercel.app');
  });

  it('未知のキーはエラーになる(誤送信を防ぐ)', () => {
    expect(() => buildBf6Broadcast('does-not-exist')).toThrow();
  });
});

describe('オンライン配信の案内テンプレート', () => {
  it('テンプレートが存在し、宛先は「有効な注文すべて」', () => {
    const t = BF6_BROADCAST_TEMPLATES.find((x) => x.key === 'stream-invite-1');
    expect(t).toBeTruthy();
    // 買い手は出場者だけでなく観覧客のご家族でもあるため entrants では狭すぎる
    expect(t!.audience).toBe('all');
  });

  it('件名で「遠方の家族向け」だと分かる', () => {
    const { subject } = buildBf6Broadcast('stream-invite-1');
    expect(subject).toContain('遠方');
    expect(subject).toContain('オンライン配信');
  });

  it('価格・アーカイブ・購入URLが入る', () => {
    const { body } = buildBf6Broadcast('stream-invite-1');
    expect(body).toContain('¥1,500');
    expect(body).toContain('1週間のアーカイブ');
    expect(body).toContain('https://bw5-app.vercel.app/bf6/stream');
  });

  it('同時視聴1端末と事前カード決済を明記する(問い合わせ・クレームの元になる)', () => {
    const { body } = buildBf6Broadcast('stream-invite-1');
    expect(body).toContain('同時に視聴できるのは1端末まで');
    expect(body).toContain('事前のカード決済のみ');
  });

  it('当日の集合時刻には触れない(2通目の役割を奪わない)', () => {
    const { body } = buildBf6Broadcast('stream-invite-1');
    expect(body).not.toContain('13:30');
  });
});

describe('宛先の範囲', () => {
  it('テンプレートごとに宛先の範囲が決まっている', () => {
    for (const t of BF6_BROADCAST_TEMPLATES) {
      expect(['entrants', 'all']).toContain(t.audience);
      expect(t.audienceNote.length).toBeGreaterThan(0);
    }
  });

  it('集合時刻の案内はエントリー者だけに送る(観覧客に送ると混乱する)', () => {
    expect(buildBf6Broadcast('call-time-1').audience).toBe('entrants');
  });
});
