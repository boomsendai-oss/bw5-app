import { describe, it, expect } from 'vitest';
import { truncateChars, charLength, jstMd, jstHm, receivedLabel } from '../inboxAlert/format';

// JST 2026-09-12 08:00 = UTC 2026-09-11 23:00
const NOW = Date.UTC(2026, 8, 11, 23, 0);

describe('truncateChars', () => {
  it('上限以内ならそのまま返す', () => {
    expect(truncateChars('あいう', 3)).toBe('あいう');
  });
  it('上限を超えたら末尾を…にして上限文字数に収める', () => {
    expect(truncateChars('あいうえお', 3)).toBe('あい…');
  });
  it('絵文字も1文字として数える', () => {
    expect(charLength('👍あ')).toBe(2);
  });
  it('絵文字を途中で切らない', () => {
    expect(truncateChars('👍👍👍', 2)).toBe('👍…');
  });
});

describe('JST表示', () => {
  it('UTCの夜はJSTの翌日の日付になる', () => {
    expect(jstMd(Date.UTC(2026, 8, 11, 23, 30))).toBe('9/12');
    expect(jstHm(Date.UTC(2026, 8, 11, 23, 30))).toBe('08:30');
  });
  it('受信日時を今日/昨日/日付で表す', () => {
    expect(receivedLabel(Date.UTC(2026, 8, 11, 22, 0), NOW)).toBe('今日07:00');
    expect(receivedLabel(Date.UTC(2026, 8, 11, 3, 10), NOW)).toBe('昨日12:10');
    expect(receivedLabel(Date.UTC(2026, 8, 9, 3, 0), NOW)).toBe('9/9');
  });
  it('JSTの0時を境に今日/昨日/日付が切り替わる', () => {
    expect(receivedLabel(Date.UTC(2026, 8, 11, 15, 0), NOW)).toBe('今日00:00');
    expect(receivedLabel(Date.UTC(2026, 8, 11, 14, 59), NOW)).toBe('昨日23:59');
    expect(receivedLabel(Date.UTC(2026, 8, 10, 15, 0), NOW)).toBe('昨日00:00');
    expect(receivedLabel(Date.UTC(2026, 8, 10, 14, 59), NOW)).toBe('9/10');
  });
});
