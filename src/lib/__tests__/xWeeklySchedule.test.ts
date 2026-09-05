import { describe, expect, it } from 'vitest';
import {
  addDaysYmd,
  buildDayLines,
  buildWeeklyPostParts,
  classLabelWithInstructor,
  classNameFromSummary,
  jstMidnightUtcIso,
  nextMondayJst,
  postMondayJst,
  shortVenue,
  type WeeklyCalEvent,
} from '../xWeeklySchedule';

const ev = (summary: string, startIso: string, location?: string): WeeklyCalEvent => ({
  summary,
  location: location ?? null,
  startIso,
});

describe('classNameFromSummary', () => {
  it('講師プレフィックスを除去する', () => {
    expect(classNameFromSummary('【TARO】キッズHIPHOP')).toBe('キッズHIPHOP');
  });
  it('プレフィックスが無ければそのまま', () => {
    expect(classNameFromSummary('HOUSE初級')).toBe('HOUSE初級');
  });
});

describe('shortVenue', () => {
  it('空白以降を落とし7文字に丸める', () => {
    expect(shortVenue('宮城野区文化センター リハーサル室')).toBe('宮城野区文化');
    expect(shortVenue('GOAT')).toBe('GOAT');
    expect(shortVenue(null)).toBe('');
  });
});

describe('buildDayLines', () => {
  it('休講を除外し、曜日ごとにまとめ、同日重複を畳む', () => {
    const lines = buildDayLines([
      ev('【TARO】キッズHIPHOP', '2026-07-20T08:00:00Z', '長町コナスポスタジオ'),
      ev('【K@TTSU】HOUSE', '2026-07-20T10:00:00Z', 'GOAT'),
      ev('【休講】【TARO】強化クラス', '2026-07-21T09:00:00Z', 'GOAT'),
      ev('【TARO】キッズHIPHOP', '2026-07-20T08:00:00Z', '長町コナスポスタジオ'),
    ]);
    expect(lines).toHaveLength(1); // 7/21は休講のみ→行が立たない
    // 会場は載せない/講師名は載せる (日次と同じ扱い・TARO指示2026-08-21)
    expect(lines[0].line).toBe('▫7/20(月) 【TARO】キッズHIPHOP・【K@TTSU】HOUSE');
  });

  it('クラス名が講師名で始まる場合は講師名を重複させない', () => {
    const lines = buildDayLines([
      ev('【SAYUKI】SAYUKI FREESTYLE', '2026-07-20T05:00:00Z', 'AZUMA スタジオ'),
    ]);
    expect(lines[0].line).toContain('【SAYUKI】FREESTYLE');
    expect(lines[0].line).not.toContain('【SAYUKI】SAYUKI');
  });

  it('JSTの日付境界で振り分ける (UTC 15時 = JST 翌日0時)', () => {
    const lines = buildDayLines([ev('【A】深夜クラス', '2026-07-20T15:00:00Z')]);
    expect(lines[0].line).toContain('7/21(火)');
  });
});

describe('buildWeeklyPostParts', () => {
  it('イベント0件(または休講のみ)なら null', () => {
    expect(buildWeeklyPostParts([], { month: 7, day: 20 }, { month: 7, day: 26 })).toBeNull();
    expect(
      buildWeeklyPostParts([ev('【休講】【A】X', '2026-07-20T08:00:00Z')], { month: 7, day: 20 }, { month: 7, day: 26 })
    ).toBeNull();
  });

  it('ヘッダー入りの複数partに分割され、各partが140字以内でCTAで終わる', () => {
    const events: WeeklyCalEvent[] = [];
    const names = ['キッズHIPHOP初級', 'HOUSEエキスパート', 'ベーシックダンス', 'HIPHOP中級', '強化クラス'];
    for (let d = 0; d < 7; d++) {
      for (let i = 0; i < 3; i++) {
        const hh = String(8 + i).padStart(2, '0');
        events.push(
          ev(`【講師${i}】${names[(d + i) % names.length]}`, `2026-07-${20 + d}T${hh}:00:00+09:00`, '長町コナスポスタジオ')
        );
      }
    }
    const parts = buildWeeklyPostParts(events, { month: 7, day: 20 }, { month: 7, day: 26 })!;
    expect(parts.length).toBeGreaterThan(1);
    expect(parts[0]).toContain('【今週のレッスン】7/20(月)〜7/26(日)');
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(140);
    expect(parts[parts.length - 1]).toContain('公式LINE');
  });

  it('1日に9クラスある日も1ツイート140字以内に分割される', () => {
    const events: WeeklyCalEvent[] = [];
    const names = [
      '多賀城 HIPHOP 初級', 'はじめてのHIPHOP', 'キッズHIPHOP入門', '多賀城 HIPHOP 入門', 'キッズHIPHOP初級',
      'ちゃんなつ HIPHOP', 'おっちゃん NEW JACK SWING', 'SAYUKI FREESTYLE', 'ベーシックダンスクラス',
    ];
    names.forEach((n, i) => {
      const hh = String(9 + i).padStart(2, '0');
      events.push(ev(`【講師${i}】${n}`, `2026-07-26T${hh}:00:00+09:00`, i % 2 ? 'GOATスタジオ' : 'AZUMA'));
    });
    const parts = buildWeeklyPostParts(events, { month: 7, day: 20 }, { month: 7, day: 26 })!;
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(140);
    // 分割2行目以降は「…」付きラベルで日付が分かる
    expect(parts.join('\n')).toContain('▫7/26(日)…');
    // 全クラスがどこかのpartに含まれる
    for (const n of names) expect(parts.join('\n')).toContain(n);
  });

  it('少ない週は1〜2partに収まりCTAが結合される', () => {
    const parts = buildWeeklyPostParts(
      [ev('【TARO】キッズHIPHOP', '2026-07-20T08:00:00+09:00', 'GOAT')],
      { month: 7, day: 20 },
      { month: 7, day: 26 }
    )!;
    expect(parts.length).toBeLessThanOrEqual(2);
    expect(parts[parts.length - 1]).toContain('公式LINE');
  });
});

describe('nextMondayJst', () => {
  it('日曜夜(JST)なら翌日の月曜を返す', () => {
    // 2026-07-19 は日曜。21:00 JST = 12:00 UTC
    expect(nextMondayJst(new Date('2026-07-19T12:00:00Z'))).toBe('2026-07-20');
  });
  it('月曜に実行したら翌週の月曜を返す', () => {
    expect(nextMondayJst(new Date('2026-07-20T03:00:00Z'))).toBe('2026-07-27');
  });
  it('JSTの日付で曜日判定する (土曜UTC深夜=日曜JST)', () => {
    // 2026-07-18T16:00Z = 7/19(日) 01:00 JST → 翌月曜 7/20
    expect(nextMondayJst(new Date('2026-07-18T16:00:00Z'))).toBe('2026-07-20');
  });
});

describe('date helpers', () => {
  it('jstMidnightUtcIso は前日15:00Zになる', () => {
    expect(jstMidnightUtcIso('2026-07-20')).toBe('2026-07-19T15:00:00.000Z');
  });
  it('addDaysYmd', () => {
    expect(addDaysYmd('2026-07-20', 6)).toBe('2026-07-26');
    expect(addDaysYmd('2026-07-31', 1)).toBe('2026-08-01');
  });
});

describe('classLabelWithInstructor: 講師未定の扱い(2026-09-05)', () => {
  it('【未定】【不明】は【】ごと落としてクラス名だけにする', () => {
    expect(classLabelWithInstructor('【未定】ダンスバトル練習会')).toBe('ダンスバトル練習会');
    expect(classLabelWithInstructor('【不明】キッズ強化クラス')).toBe('キッズ強化クラス');
  });
});

describe('postMondayJst: 投稿対象週の月曜(2026-09-05)', () => {
  it('月曜の朝に走ったら「今日」を返す(nextMondayJstだと来週になってしまう)', () => {
    expect(postMondayJst(new Date('2026-09-06T22:10:00Z'))).toBe('2026-09-07'); // 月曜 07:10 JST
  });
  it('日曜なら翌日の月曜', () => {
    expect(postMondayJst(new Date('2026-09-06T12:00:00Z'))).toBe('2026-09-07'); // 日曜 21:00 JST
  });
  it('火曜以降は次の月曜', () => {
    expect(postMondayJst(new Date('2026-09-08T03:00:00Z'))).toBe('2026-09-14');
  });
});
