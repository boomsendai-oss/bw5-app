import { describe, it, expect } from 'vitest';
import { formatKeikoMail, isEmptyBody, jpDate } from '../reportMail';

describe('jpDate', () => {
  it('M/D(曜) に整形する', () => {
    expect(jpDate('2026-07-26')).toBe('7/26(日)');
    expect(jpDate('2026-01-01')).toBe('1/1(木)');
  });
  it('不正な文字列は件名を壊さずそのまま返す', () => {
    expect(jpDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatKeikoMail', () => {
  it('コピペ範囲を明示する', () => {
    const { subject, text } = formatKeikoMail('2026-07-26', '・日曜キッズの告知を配信しました\n');
    expect(subject).toBe('【KEIKOさん共有】7/26(日)のぶん（LINEにコピペ用）');
    expect(text).toContain('───────── ここからコピペ ─────────');
    expect(text).toContain('・日曜キッズの告知を配信しました');
    expect(text).toContain('───────── ここまで ─────────');
  });

  it('送るまでもなければ無視してよいと伝える(TAROの運用に合わせる)', () => {
    const { text } = formatKeikoMail('2026-07-26', 'なにか');
    expect(text).toContain('無視してOK');
  });
});

describe('isEmptyBody', () => {
  it('空白・見出しだけの本文は「中身なし」とみなす', () => {
    expect(isEmptyBody('')).toBe(true);
    expect(isEmptyBody('   \n\n  ')).toBe(true);
    expect(isEmptyBody('# 2026-07-26\n\n---\n')).toBe(true);
  });
  it('1行でも中身があれば送る', () => {
    expect(isEmptyBody('# 2026-07-26\n\n・新しいクラスの日程が決まりました')).toBe(false);
  });
});
