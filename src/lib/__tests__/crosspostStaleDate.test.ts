import { describe, it, expect } from 'vitest';
import { findExpiredMention, extractDateMentions, staleReason } from '../crosspostStaleDate';

// 公開日時は reel_queue.posted_at と同じUTCのISO。19:02Z = 翌日 JST 4:02 にならないよう 10:02Z(JST 19:02)
const PUB_1110 = '2026-11-10T10:02:15.504Z'; // JST 11/10
const now = (jst: string) => new Date(`${jst}T12:00:00+09:00`);

const REEL80 = `HIPHOP 入門 ／ 水曜 18:45〜19:45
🕺講師：@haruki_brat.ii

動画は10/3のワークショップの様子で、少し難しめの内容です。
12月から始まる「HIPHOP 入門」は、はじめての方向けのやさしいクラスです。

▼開講前のお試しレッスン
明日11/11(水) 18:45〜19:45（GOATスタジオ・本町）
📍12月からは、Kスタジオ（花京院）で毎週水曜に開催します。

#仙台ダンススクール #11/30`;

describe('findExpiredMention', () => {
  it('2026-11-13の実例: 11/10公開「明日11/11」は11/13には日付切れ', () => {
    const m = findExpiredMention(REEL80, PUB_1110, now('2026-11-13'));
    expect(m).not.toBeNull();
    expect(m!.date).toBe('2026-11-11');
  });

  it('告知の当日まではまだ出してよい(11/11はセーフ)', () => {
    expect(findExpiredMention(REEL80, PUB_1110, now('2026-11-11'))).toBeNull();
  });

  it('公開当日は判定しない', () => {
    expect(findExpiredMention(REEL80, PUB_1110, now('2026-11-10'))).toBeNull();
  });

  it('撮影日の説明(公開時点で過去の日付)では外さない', () => {
    const cap = '動画は10/3のワークショップの様子です。\n毎週水曜 18:45〜';
    expect(findExpiredMention(cap, PUB_1110, now('2026-11-20'))).toBeNull();
  });

  it('日付の無い本文は外さない', () => {
    const cap = '【BOOM WOP vol.5】Change 🕺\n📍水曜 20:00〜21:30\n体験レッスンは無料。';
    expect(findExpiredMention(cap, PUB_1110, now('2026-12-31'))).toBeNull();
  });

  it('「12月から」のような月だけの言及は見ない', () => {
    const cap = '※12月からは、木曜 20:00〜21:30「HIPHOP」に時間が変わります。';
    expect(findExpiredMention(cap, PUB_1110, now('2027-01-10'))).toBeNull();
  });

  it('ハッシュタグ行の日付は見ない', () => {
    expect(findExpiredMention('レッスン\n#11/11', PUB_1110, now('2026-11-20'))).toBeNull();
  });

  it('「明日」だけでも公開日+1で判定する', () => {
    const cap = '明日、第2回をやります。';
    expect(findExpiredMention(cap, '2026-10-21T10:01:35Z', now('2026-10-22'))).toBeNull();
    expect(findExpiredMention(cap, '2026-10-21T10:01:35Z', now('2026-10-23'))!.date).toBe('2026-10-22');
  });

  it('11月11日 の表記も拾う', () => {
    const cap = '11月11日(水)にお試しレッスン';
    expect(findExpiredMention(cap, PUB_1110, now('2026-11-12'))!.date).toBe('2026-11-11');
  });

  it('年をまたぐ: 12/28公開の「1/5」は翌年1/5', () => {
    const cap = '1/5(月)から再開します';
    expect(findExpiredMention(cap, '2026-12-28T10:00:00Z', now('2027-01-04'))).toBeNull();
    expect(findExpiredMention(cap, '2026-12-28T10:00:00Z', now('2027-01-06'))!.date).toBe('2027-01-05');
  });

  it('年あり表記', () => {
    const cap = '2026/11/11 開催';
    expect(findExpiredMention(cap, PUB_1110, now('2026-11-12'))!.date).toBe('2026-11-11');
  });

  it('時刻(18:45)や分数のような数字の並びを日付と誤読しない', () => {
    const cap = '18:45〜19:45 / 月謝 1/2 オフ';
    // 1/2 は日付として読めるが公開時点で過去(1月2日)なので外さない
    expect(findExpiredMention(cap, PUB_1110, now('2026-11-20'))).toBeNull();
  });

  it('キャプションや公開日時が無ければ判定しない', () => {
    expect(findExpiredMention(null, PUB_1110, now('2026-11-20'))).toBeNull();
    expect(findExpiredMention(REEL80, null, now('2026-11-20'))).toBeNull();
    expect(findExpiredMention(REEL80, 'garbage', now('2026-11-20'))).toBeNull();
  });

  it('今週末: 公開日以降の最初の日曜', () => {
    const cap = '今週末はイベント出演です';
    // 2026-11-10は火曜 → 11/15(日)
    expect(extractDateMentions(cap, '2026-11-10')[0].date).toBe('2026-11-15');
  });
});

describe('staleReason', () => {
  it('理由文に言及と日付が入る', () => {
    expect(staleReason({ text: '明日', date: '2026-11-11' })).toContain('「明日」(2026-11-11)');
  });
});
