import { describe, it, expect } from 'vitest';
import { pickDue, formatReminderBody, type ReminderRow } from '../reminders';

const row = (o: Partial<ReminderRow>): ReminderRow => ({
  id: 1,
  due_date: '2026-08-10',
  title: 'テスト',
  body: '本文',
  sent_at: null,
  ...o,
});

describe('pickDue', () => {
  it('期日当日は対象になる', () => {
    expect(pickDue([row({ due_date: '2026-08-10' })], '2026-08-10').map((r) => r.id)).toEqual([1]);
  });

  it('期日前は対象にならない', () => {
    expect(pickDue([row({ due_date: '2026-08-10' })], '2026-08-09')).toEqual([]);
  });

  it('期日を過ぎていても未送信なら対象になる(取りこぼしを拾う)', () => {
    expect(pickDue([row({ due_date: '2026-08-10' })], '2026-09-01').map((r) => r.id)).toEqual([1]);
  });

  it('送信済みは二度と対象にしない', () => {
    expect(pickDue([row({ sent_at: '2026-08-10T00:05:00.000Z' })], '2026-08-11')).toEqual([]);
  });

  it('期日の早い順に並べる', () => {
    const got = pickDue(
      [
        row({ id: 1, due_date: '2026-09-01' }),
        row({ id: 2, due_date: '2026-08-10' }),
        row({ id: 3, due_date: '2026-08-20' }),
      ],
      '2026-10-01'
    );
    expect(got.map((r) => r.id)).toEqual([2, 3, 1]);
  });

  it('対象が無ければ空', () => {
    expect(pickDue([], '2026-08-10')).toEqual([]);
  });
});

describe('formatReminderBody', () => {
  it('本文と期日を含める', () => {
    const t = formatReminderBody(row({ due_date: '2026-08-10', body: 'オーナーを切り替える' }));
    expect(t).toContain('オーナーを切り替える');
    expect(t).toContain('2026-08-10');
  });

  it('本文が空でも落ちない', () => {
    expect(() => formatReminderBody(row({ body: '' }))).not.toThrow();
  });

  it('期日を過ぎている場合はその旨を添える', () => {
    const t = formatReminderBody(row({ due_date: '2026-08-10' }), '2026-08-15');
    expect(t).toContain('過ぎています');
  });
});
