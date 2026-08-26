import { describe, it, expect } from 'vitest';
import { buildBf6CancelEmail } from '../bf6CancelEmail';

const base = {
  orderId: 10,
  buyerName: '若生みゅう',
  dancerNames: ['MYU'],
  divisionLabels: ['一般部門'],
  refundAmount: 2000,
};

describe('キャンセル完了メールの文面', () => {
  it('件名でキャンセル完了だと分かり、受付番号が入る', () => {
    const { subject } = buildBf6CancelEmail(base);
    expect(subject).toContain('キャンセル');
    expect(subject).toContain('BF6-010');
  });

  it('宛名と、どの出場者のどの部門がキャンセルされたかを書く', () => {
    const { text } = buildBf6CancelEmail(base);
    expect(text).toContain('若生みゅう 様');
    expect(text).toContain('MYU');
    expect(text).toContain('一般部門');
  });

  it('返金がある場合は金額と、カードへの返金である旨・反映までの目安を書く', () => {
    const { text } = buildBf6CancelEmail(base);
    expect(text).toContain('¥2,000');
    expect(text).toContain('返金');
    expect(text).toContain('カード');
  });

  it('返金が0円のときは返金の話を書かない(当日現金など)', () => {
    const { text } = buildBf6CancelEmail({ ...base, refundAmount: 0 });
    expect(text).not.toContain('返金手続き');
    expect(text).not.toContain('¥0');
  });

  it('再エントリーの導線を残す(締切前にまた出たくなる場合があるため)', () => {
    const { text } = buildBf6CancelEmail(base);
    expect(text).toContain('https://boomersfight.vercel.app');
  });

  it('問い合わせ先を書く', () => {
    const { text } = buildBf6CancelEmail(base);
    expect(text).toContain('BOOM');
  });

  it('出場者が複数でも全員ぶん並ぶ', () => {
    const { text } = buildBf6CancelEmail({
      ...base,
      dancerNames: ['MYU', 'AOI'],
    });
    expect(text).toContain('MYU');
    expect(text).toContain('AOI');
  });
});
