import { describe, it, expect } from 'vitest';
import { findOverdueSlots, hhmmToMinutes, describeOverdueSlot } from '../slotWatch';

const slot = (slotTime: string, mediaPath: string, note: string | null = null) => ({ slotTime, mediaPath, note });

describe('hhmmToMinutes', () => {
  it('HH:MMを分に直す', () => {
    expect(hhmmToMinutes('00:00')).toBe(0);
    expect(hhmmToMinutes('12:30')).toBe(750);
    expect(hhmmToMinutes('23:59')).toBe(1439);
  });
  it('壊れた値はnull(呼び出し側で無視できる)', () => {
    expect(hhmmToMinutes('24:00')).toBeNull();
    expect(hhmmToMinutes('9:00')).toBeNull();
    expect(hhmmToMinutes('')).toBeNull();
  });
});

describe('findOverdueSlots', () => {
  const slots = [slot('12:00', '/stories/extra/bw6.mp4', 'BW6ティザー')];

  it('猶予の中は鳴らさない(cronの遅延は正常)', () => {
    expect(findOverdueSlots(slots, [], hhmmToMinutes('12:59')!)).toEqual([]);
  });

  it('猶予を過ぎて未投稿なら検知する', () => {
    const r = findOverdueSlots(slots, [], hhmmToMinutes('13:37')!);
    expect(r).toHaveLength(1);
    expect(r[0].slotTime).toBe('12:00');
    expect(r[0].lateMinutes).toBe(97);
  });

  it('投稿済みなら鳴らさない(時刻つきキー)', () => {
    expect(findOverdueSlots(slots, ['/stories/extra/bw6.mp4#12:00'], hhmmToMinutes('20:00')!)).toEqual([]);
  });

  it('時刻なしの旧ログ形式でも投稿済みとみなす(過去データとの互換)', () => {
    expect(findOverdueSlots(slots, ['/stories/extra/bw6.mp4'], hhmmToMinutes('20:00')!)).toEqual([]);
  });

  it('予定時刻より前は対象外', () => {
    expect(findOverdueSlots(slots, [], hhmmToMinutes('08:00')!)).toEqual([]);
  });

  it('同じ素材を1日2回出す枠は別々に判定する(9/24の締切当日)', () => {
    const two = [slot('12:30', '/stories/extra/cd0.png'), slot('21:00', '/stories/extra/cd0.png')];
    // 12:30ぶんだけ投稿済み → 21:00は未投稿として残る
    const r = findOverdueSlots(two, ['/stories/extra/cd0.png#12:30'], hhmmToMinutes('22:30')!);
    expect(r.map((x) => x.slotTime)).toEqual(['21:00']);
  });

  it('前日ぶんは+1440分として評価できる(翌朝に前夜21:00の落ちを拾う)', () => {
    const night = [slot('21:00', '/stories/extra/bf6_cd3.png')];
    const r = findOverdueSlots(night, [], hhmmToMinutes('09:10')! + 1440);
    expect(r).toHaveLength(1);
    expect(r[0].lateMinutes).toBe(730); // 21:00 → 翌9:10 = 12時間10分
  });

  it('壊れた時刻の枠は無視して他を評価し続ける', () => {
    const mixed = [slot('99:99', '/stories/a.png'), slot('12:00', '/stories/b.png')];
    expect(findOverdueSlots(mixed, [], hhmmToMinutes('23:00')!).map((x) => x.mediaPath)).toEqual(['/stories/b.png']);
  });
});

describe('describeOverdueSlot', () => {
  it('日付・時刻・ファイル名・遅れをそのまま読める1行にする', () => {
    const line = describeOverdueSlot('2026-09-21', {
      slotTime: '21:00', mediaPath: '/stories/extra/bf6_cd3.png', note: 'BF6告知', lateMinutes: 730,
    });
    expect(line).toContain('2026-09-21 21:00');
    expect(line).toContain('bf6_cd3.png');
    expect(line).toContain('12時間10分');
    expect(line).toContain('BF6告知');
  });

  it('1時間を超えたら「N時間M分」で書く', () => {
    const line = describeOverdueSlot('2026-08-23', {
      slotTime: '12:00', mediaPath: '/stories/extra/bw6.mp4', note: null, lateMinutes: 62,
    });
    expect(line).toContain('1時間2分');
  });
});
