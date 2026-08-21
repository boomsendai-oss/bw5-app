import { describe, expect, it } from 'vitest';
import { buildDailyPostParts } from '../xWeeklySchedule';

const ev = (startIso: string, summary: string, location?: string) => ({ startIso, summary, location });

describe('buildDailyPostParts (本日のレッスン・毎朝の層0投稿)', () => {
  it('イベント0件なら null (投稿を作らない)', () => {
    expect(buildDailyPostParts([], { month: 8, day: 7, weekday: 5 })).toBeNull();
  });

  it('ヘッダーは【本日のレッスン】M/D(曜)', () => {
    const parts = buildDailyPostParts(
      [ev('2026-08-07T08:00:00Z', '【AZUMA】キッズHIPHOP', '多賀城スタジオ')],
      { month: 8, day: 7, weekday: 5 }
    )!;
    expect(parts[0]).toContain('【本日のレッスン】8/7(金)');
  });

  it('行は ▫HH:MM 【講師】クラス名 形式・JST時刻・会場は載せない(TARO指示2026-08-20/21)', () => {
    const parts = buildDailyPostParts(
      [ev('2026-08-07T08:00:00Z', '【AZUMA】キッズHIPHOP', '多賀城スタジオ')],
      { month: 8, day: 7, weekday: 5 }
    )!;
    expect(parts.join('\n')).toContain('▫17:00 【AZUMA】キッズHIPHOP');
    expect(parts.join('\n')).not.toContain('多賀城スタジオ');
  });

  it('クラス名が講師名で始まる場合は講師名を重複させない', () => {
    const parts = buildDailyPostParts(
      [
        ev('2026-08-07T05:00:00Z', '【SAYUKI】SAYUKI FREESTYLE', 'AZUMA スタジオ'),
        ev('2026-08-07T05:30:00Z', '【おっちゃん】おっちゃん NEW JACK SWING', 'AZUMA スタジオ'),
      ],
      { month: 8, day: 7, weekday: 5 }
    )!;
    const text = parts.join('\n');
    expect(text).toContain('▫14:00 【SAYUKI】FREESTYLE');
    expect(text).toContain('▫14:30 【おっちゃん】NEW JACK SWING');
    expect(text).not.toContain('【SAYUKI】SAYUKI');
    expect(text).not.toContain('【おっちゃん】おっちゃん');
  });

  it('講師名の【】が無いイベントはクラス名のみ', () => {
    const parts = buildDailyPostParts(
      [ev('2026-08-07T08:00:00Z', 'ダンス部', null as unknown as string)],
      { month: 8, day: 7, weekday: 5 }
    )!;
    expect(parts.join('\n')).toContain('▫17:00 ダンス部');
  });

  it('時刻順に並ぶ', () => {
    const parts = buildDailyPostParts(
      [
        ev('2026-08-07T10:00:00Z', '【KEIKO】HOUSE', '長町'),
        ev('2026-08-07T08:00:00Z', '【AZUMA】キッズHIPHOP', '多賀城'),
      ],
      { month: 8, day: 7, weekday: 5 }
    )!;
    const text = parts.join('\n');
    expect(text.indexOf('17:00')).toBeLessThan(text.indexOf('19:00'));
  });

  it('【休講】は除外し、全件休講なら null', () => {
    expect(
      buildDailyPostParts([ev('2026-08-07T08:00:00Z', '【休講】【AZUMA】キッズHIPHOP', '多賀城')], {
        month: 8,
        day: 7,
        weekday: 5,
      })
    ).toBeNull();
  });

  it('CTAで締める(公式LINE誘導)', () => {
    const parts = buildDailyPostParts(
      [ev('2026-08-07T08:00:00Z', '【AZUMA】キッズHIPHOP', '多賀城')],
      { month: 8, day: 7, weekday: 5 }
    )!;
    expect(parts[parts.length - 1]).toContain('公式LINE');
  });

  it('本数が多くても各partが予算内に分割される', () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      ev(`2026-08-07T${String(6 + i).padStart(2, '0')}:00:00Z`, `【T】ながいなまえのクラス${i}ばんめ`, 'とてもながいスタジオめい')
    );
    const parts = buildDailyPostParts(many, { month: 8, day: 7, weekday: 5 })!;
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(150);
  });
});
