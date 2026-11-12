// BW6 発表会（段階1）のスタッフの申込の一覧（Task 19）の DB の試験（実 DB・試験用のファイル DB ./data/test_recital_entries_staff.db）。
// 試験ごとに自分の発表会のキー（t-ent-…）の行だけを見る。
import { describe, it, expect, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { mailStatusLabel } from '../../app/staff/bw6/labels';
import { seedEvent, seedHousehold, seedRules, seedWork } from './recitalStaffSeed';

const TEST_DB = './data/test_recital_entries_staff.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let db: typeof import('../recitalDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  db = await import('../recitalDb');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

function pick<T extends object, K extends keyof T>(o: T, keys: K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = o[k];
  return out;
}

describe('listEntryRows', () => {
  it('お金と見え方が世帯の画面（loadHouseholdDetail）と同じ・merged は出ない・新しい順', async () => {
    const ev = 't-ent-1'; await seedEvent(ev); await seedRules(ev);
    const w1 = await seedWork(ev, 'W01'); const w2 = await seedWork(ev, 'W02');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });                                    // 仮受付 26,500
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }], payments: [26500] });                 // 申込完了
    const c = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in'], [w2, 'in']] }], payments: [26500] });     // 追加分 6,000
    const d = await seedHousehold(ev, { people: [{ casts: [[w1, 'out']] }] });                                                   // 出演なし
    const m = await seedHousehold(ev, { people: [{ casts: [[w1, 'in']] }] });
    await core.execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [a.householdId, m.householdId]);
    const rows = await db.listEntryRows(ev);
    expect(rows.map((r) => r.id)).toEqual([d, c, b, a].map((h) => h.householdId));
    expect(rows.find((r) => r.id === c.householdId)).toMatchObject({ total: 32500, paid: 26500, remaining: 6000, view: 'complete_extra', worksCount: 2, peopleCount: 1 });
    expect(rows.find((r) => r.id === a.householdId)).toMatchObject({ view: 'tentative', remaining: 26500 });
    expect(rows.find((r) => r.id === b.householdId)).toMatchObject({ view: 'complete', remaining: 0 });
    expect(rows.find((r) => r.id === d.householdId)).toMatchObject({ view: 'none' });
    for (const r of rows) {
      const det = await db.loadHouseholdDetail(r.id);
      expect({ total: r.total, paid: r.paid, remaining: r.remaining, view: r.view }).toEqual({ ...pick(det!.money, ['total', 'paid', 'remaining']), view: det!.view });
    }
  });
  it('振り込みましたの印がある世帯は bankTold が true', async () => {
    const ev = 't-ent-2'; await seedEvent(ev); await seedRules(ev); const w1 = await seedWork(ev, 'W01');
    const a = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    const b = await seedHousehold(ev, { recompute: true, people: [{ casts: [[w1, 'in']] }] });
    await core.execute(`UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-21', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [new Date().toISOString(), a.householdId]);
    const rows = await db.listEntryRows(ev);
    expect(rows.find((r) => r.id === a.householdId)?.bankTold).toBe(true);
    expect(rows.find((r) => r.id === b.householdId)?.bankTold).toBe(false);
  });
});

describe('送ったメールの状態の言葉（Task 10 の申し送り）', () => {
  it('waiting で sent_at がある行は「送れたか不明」、ほかは表のとおり', () => {
    expect(mailStatusLabel({ status: 'waiting', sent_at: '2026-12-15T03:00:00.000Z' })).toBe('送れたか不明');
    expect(mailStatusLabel({ status: 'waiting', sent_at: null })).toBe('待ち');
    expect(mailStatusLabel({ status: 'sent', sent_at: '2026-12-15T03:00:00.000Z' })).toBe('送った');
    expect(mailStatusLabel({ status: 'failed', sent_at: '2026-12-15T03:00:00.000Z' })).toBe('失敗');
    expect(mailStatusLabel({ status: 'cancelled', sent_at: null })).toBe('取りやめ');
  });
});
