import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { trialDedupKey, TRIAL_CONFLICT_TARGET } from '../trialDedup';

describe('trialDedupKey', () => {
  it('同じLINEアカウント・同じ枠でも申込者名が違えば別のキーになる（兄弟など）', () => {
    const a = trialDedupKey('278662425', '2026-11-15 17:30:00', '鈴木琢');
    const b = trialDedupKey('278662425', '2026-11-15 17:30:00', '鈴木花');
    expect(a).not.toBe(b);
  });

  it('同じ人（同アカウント・同枠・同名）は同じキー＝再取込で更新に回る', () => {
    const a = trialDedupKey('278662425', '2026-11-15 17:30:00', '鈴木琢');
    const b = trialDedupKey('278662425', '2026-11-15 17:30:00', '鈴木琢');
    expect(a).toBe(b);
  });

  it('申込者名が null でも落ちず、空文字として扱う', () => {
    expect(trialDedupKey('x', 't', null)).toBe('x|t|');
    expect(trialDedupKey(null, 't', null)).toBe('|t|');
  });
});

// 本番と同じ DDL（移行ファイル）と ON CONFLICT 対象で、1アカウント複数人が別行として
// 取り込まれ、かつ同一人物の再取込では増えない（冪等）ことを実DBで確かめる。
describe('trial_records 重複判定（移行＋UPSERT統合）', () => {
  async function freshDb() {
    const c = createClient({ url: ':memory:' });
    await c.execute(`CREATE TABLE trial_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lstep_id TEXT, member_id INTEGER, reserved_at TEXT NOT NULL,
      lesson_name TEXT, status TEXT, status_source TEXT, status_updated_at TEXT,
      applicant_name TEXT, applicant_name_kana TEXT, applicant_age TEXT,
      course_type TEXT, dance_experience TEXT, referral_source TEXT, referrer_kana TEXT)`);
    // 旧インデックス（直す前の状態）を作ってから移行を当てる
    await c.execute('CREATE UNIQUE INDEX uq_trial_lstep_reserved_at ON trial_records(lstep_id, reserved_at)');
    const mig = readFileSync(
      join(__dirname, '../../../scripts/migrations/20261115_trial_records_unique_name.sql'),
      'utf8'
    );
    for (const s of mig.split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) {
      await c.execute(s);
    }
    return c;
  }

  const insertSql = `INSERT INTO trial_records
      (lstep_id, member_id, reserved_at, lesson_name, status, status_source, status_updated_at, applicant_name)
    VALUES (?, ?, ?, ?, ?, 'lstep_calendar_csv', ?, ?)
    ON CONFLICT(${TRIAL_CONFLICT_TARGET}) DO UPDATE SET
      status = excluded.status, status_updated_at = excluded.status_updated_at,
      applicant_name = COALESCE(excluded.applicant_name, trial_records.applicant_name)`;

  it('同アカウント・同枠・別名の2人が別々の行として残る', async () => {
    const c = await freshDb();
    // 先に1人目（既存＝id235相当）
    await c.execute({ sql: insertSql, args: ['278662425', null, '2026-11-15 17:30:00', '(日) ちゃんなつ HIPHOP', '予約済', '2026-11-15T00:00:00Z', '鈴木琢'] });
    // 2人目（兄弟）
    await c.execute({ sql: insertSql, args: ['278662425', null, '2026-11-15 17:30:00', '(日) ちゃんなつ HIPHOP', '予約済', '2026-11-15T00:01:00Z', '鈴木花'] });
    const r = await c.execute("SELECT applicant_name FROM trial_records WHERE lstep_id='278662425' AND reserved_at='2026-11-15 17:30:00' ORDER BY applicant_name");
    expect(r.rows.length).toBe(2);
    expect(r.rows.map((x) => x.applicant_name).sort()).toEqual(['鈴木琢', '鈴木花'].sort());
  });

  it('同一人物の再取込では行は増えず更新される（冪等）', async () => {
    const c = await freshDb();
    await c.execute({ sql: insertSql, args: ['278662425', null, '2026-11-15 17:30:00', 'x', '予約済', '2026-11-15T00:00:00Z', '鈴木琢'] });
    await c.execute({ sql: insertSql, args: ['278662425', null, '2026-11-15 17:30:00', 'x', 'キャンセル', '2026-11-15T00:05:00Z', '鈴木琢'] });
    const r = await c.execute("SELECT status FROM trial_records WHERE lstep_id='278662425'");
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].status).toBe('キャンセル');
  });
});
