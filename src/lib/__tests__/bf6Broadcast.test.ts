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
