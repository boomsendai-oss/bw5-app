import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
      expect(['entrants', 'all', 'cash_due']).toContain(t.audience);
      expect(t.audienceNote.length).toBeGreaterThan(0);
    }
  });

  it('集合時刻の案内はエントリー者だけに送る(観覧客に送ると混乱する)', () => {
    expect(buildBf6Broadcast('call-time-1').audience).toBe('entrants');
  });

  // ⚠️ 受け取り済みの人に「当日お支払いください」と送ると事故になる
  it('当日現金の案内は、まだ払っていない人だけに送る', () => {
    expect(buildBf6Broadcast('cash-due-1').audience).toBe('cash_due');
  });

  it('当日現金の案内には金額と内訳の差し込みがある(金額を書き忘れない)', () => {
    const b = buildBf6Broadcast('cash-due-1').body;
    expect(b).toContain('{{amount}}');
    expect(b).toContain('{{breakdown}}');
  });
});

describe('当日のご案内(バトル出場者の方へ)', () => {
  // TARO 2026-09-22 承認の文面
  it('テンプレートがあり、宛先はバトルエントリー者', () => {
    const t = BF6_BROADCAST_TEMPLATES.find((x) => x.key === 'entrant-guide-1');
    expect(t).toBeTruthy();
    expect(t!.audience).toBe('entrants');
  });

  it('集合・エレベーターでの行き方・タブレットでの受付が入る', () => {
    const { subject, body } = buildBf6Broadcast('entrant-guide-1');
    expect(subject).toContain('当日のご案内');
    expect(body).toContain('13:30〜14:00');
    expect(body).toContain('エレベーターが2つ');
    expect(body).toContain('9階へ直接');
    expect(body).toContain('タブレット');
  });

  it('保護者の入場受付・当日現金のまとめ払いをお願いする', () => {
    const { body } = buildBf6Broadcast('entrant-guide-1');
    expect(body).toContain('リストバンド');
    expect(body).toContain('開場の14:30から');
    expect(body).toContain('エントリー費と観覧チケットのお支払い');
  });

  it('柔道場・飲食禁止とその理由・立ち入り・不戦敗・貴重品を必ず書く', () => {
    const { body } = buildBf6Broadcast('entrant-guide-1');
    expect(body).toContain('柔道場を控室として');
    expect(body).toContain('飲食禁止');
    expect(body).toContain('今後この会場を使えなくなります');
    expect(body).toContain('用のないフロア・お部屋には立ち入らないでください');
    expect(body).toContain('不戦敗');
    expect(body).toContain('貴重品');
  });

  it('地図とタイムテーブルの画像を添付する(ファイルが実在する)', () => {
    const { attachments } = buildBf6Broadcast('entrant-guide-1');
    expect(attachments.map((a) => a.filename)).toEqual(['控室（柔道場）への行き方.png', 'タイムテーブル.png']);
    for (const a of attachments) {
      expect(existsSync(join(process.cwd(), 'public', a.path))).toBe(true);
    }
  });

  it('ほかのテンプレートには添付を付けない', () => {
    expect(buildBf6Broadcast('call-time-1').attachments).toEqual([]);
  });
});
