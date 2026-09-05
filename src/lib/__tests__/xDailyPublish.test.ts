import { describe, expect, it } from 'vitest';
import { decideImmediatePublish, decideWeeklyImmediatePublish } from '../xDailyPublish';

describe('decideImmediatePublish (本日のレッスン: 生成した場で投稿するか)', () => {
  it('10:30より前は12:30の予約に任せる', () => {
    expect(decideImmediatePublish(9, 0)).toBe('schedule');
    expect(decideImmediatePublish(10, 29)).toBe('schedule');
  });
  it('10:30〜20:30はその場で投稿(cron遅延で16〜18時に生成される実態に対応)', () => {
    expect(decideImmediatePublish(10, 30)).toBe('post-now');
    expect(decideImmediatePublish(12, 40)).toBe('post-now');
    expect(decideImmediatePublish(16, 45)).toBe('post-now');
    expect(decideImmediatePublish(20, 30)).toBe('post-now');
  });
  it('20:30より後は見送り(夜にその日の予定を流しても遅い)', () => {
    expect(decideImmediatePublish(20, 31)).toBe('too-late');
    expect(decideImmediatePublish(23, 50)).toBe('too-late');
  });
});

describe('decideWeeklyImmediatePublish (今週のレッスン)', () => {
  it('月曜 06:30〜12:00 はその場で投稿', () => {
    expect(decideWeeklyImmediatePublish(true, 7, 5)).toBe('post-now');
    expect(decideWeeklyImmediatePublish(true, 11, 59)).toBe('post-now');
  });
  it('月曜でも早朝/午後は予約(8:00)に回す・月曜以外は常に予約', () => {
    expect(decideWeeklyImmediatePublish(true, 5, 0)).toBe('schedule');
    expect(decideWeeklyImmediatePublish(true, 13, 0)).toBe('schedule');
    expect(decideWeeklyImmediatePublish(false, 9, 0)).toBe('schedule');
  });
});
