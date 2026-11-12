// 発表会の段階1の表（19表）。台帳SQLだけで作ったDBで、表・索引・一意・CHECK を確かめる。
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';

const TEST_DB = './data/test_recital_schema.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
process.env.SKIP_DB_INIT = '1'; // schema.ts を流さず、台帳SQLだけで作る（台帳の付け忘れを見つけるため）

const LEDGER = 'scripts/migrations/20261113_recital_stage1.sql';
/** scripts/migrate.mjs の splitSql と同じ分け方（行末の ; で割る） */
const splitSql = (sql: string) => sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean);
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const TABLES = [
  'recital_bank_rows', 'recital_casts', 'recital_changes', 'recital_charges', 'recital_checkouts',
  'recital_events', 'recital_fee_presets', 'recital_fee_rules', 'recital_households', 'recital_imports',
  'recital_instructor_links', 'recital_mail_log', 'recital_payments', 'recital_people', 'recital_refunds',
  'recital_settings', 'recital_work_classes', 'recital_work_instructors', 'recital_works',
];
const INDEXES = [
  'idx_recital_bank_rows_state', 'idx_recital_casts_work', 'idx_recital_changes_household',
  'idx_recital_charges_household', 'idx_recital_fee_rules_event', 'idx_recital_households_email',
  'idx_recital_households_phone', 'idx_recital_mail_log_household', 'idx_recital_payments_bankrow',
  'idx_recital_payments_household', 'idx_recital_people_household', 'idx_recital_refunds_household',
  'idx_recital_work_classes_work', 'idx_recital_work_instructors_work',
  'ux_recital_bank_rows_key', 'ux_recital_casts_pw', 'ux_recital_checkouts_open', 'ux_recital_checkouts_pi',
  'ux_recital_checkouts_session', 'ux_recital_fee_presets_member', 'ux_recital_households_ref',
  'ux_recital_households_seq', 'ux_recital_households_submit', 'ux_recital_households_token',
  'ux_recital_instructor_links_token', 'ux_recital_mail_log_dedupe', 'ux_recital_payments_event',
  'ux_recital_payments_pi', 'ux_recital_payments_session', 'ux_recital_people_ext', 'ux_recital_people_seq',
  'ux_recital_works_code',
];
const NOW = '2026-11-13T00:00:00.000Z';

let core: typeof import('../db');
let ledgerSql: string;

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  ledgerSql = readFileSync(LEDGER, 'utf8');
  core = await import('../db');
  await core.batch(splitSql(ledgerSql), 'write');
});

describe('台帳SQL と recitalSchema.ts', () => {
  it('(a) 台帳SQLを割った文が RECITAL_SCHEMA_STATEMENTS と一字一句同じ（空白はそろえて比べる）', async () => {
    const { RECITAL_SCHEMA_STATEMENTS } = await import('../db/recitalSchema');
    expect(splitSql(ledgerSql).map(norm)).toEqual(RECITAL_SCHEMA_STATEMENTS.map(norm));
  });
  it('台帳SQLにコメントが無い', () => {
    expect(ledgerSql).not.toMatch(/--/);
  });
  it('schema.ts の getSchemaStatements() に全部入っている', async () => {
    const { RECITAL_SCHEMA_STATEMENTS } = await import('../db/recitalSchema');
    const { getSchemaStatements } = await import('../db/schema');
    const all = getSchemaStatements().map((s) => norm(typeof s === 'string' ? s : s.sql));
    for (const st of RECITAL_SCHEMA_STATEMENTS) expect(all).toContain(norm(st));
  });
  it('(b) 台帳SQLだけで19表と索引がそろう', async () => {
    const t = await core.getAll(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'recital%' ORDER BY name`);
    expect(t.map((r) => r.name)).toEqual(TABLES);
    const i = await core.getAll(`SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_recital%' OR name LIKE 'ux_recital%') ORDER BY name`);
    expect(i.map((r) => r.name)).toEqual([...INDEXES].sort());
  });
});

describe('(c) 部分一意', () => {
  it('開いている checkout は世帯に1つ。open でなければ何個でも', async () => {
    const ins = (hh: number, st: string) => core.execute(
      `INSERT INTO recital_checkouts (event_key, household_id, amount, status, created_at) VALUES ('t-schema', ?, 26500, ?, ?)`, [hh, st, NOW]);
    await ins(1, 'open');
    await expect(ins(1, 'open')).rejects.toThrow(/UNIQUE/i);
    await ins(1, 'expired'); await ins(1, 'expired'); await ins(2, 'open');
  });
  it('void でない同じ row_key は1つ。void は何個でも、void のあとは同じ鍵を入れられる', async () => {
    const ins = (st: string) => core.execute(
      `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, balance, kind, row_key, source, state)
       VALUES ('t-schema', ?, '2026-12-20', 'in', 26500, 100000, 'transfer', '2026-12-20|in|26500|100000', 'chat', ?)`, [NOW, st]);
    await ins('new');
    await expect(ins('matched')).rejects.toThrow(/UNIQUE/i);
    await core.execute(`UPDATE recital_bank_rows SET state='void' WHERE event_key='t-schema'`);
    await ins('void'); await ins('new');
  });
  it('stripe_event_id・stripe_session_id・stripe_pi_id の重複は弾き、NULL は何個でも入る', async () => {
    const ins = (ev: string | null, ss: string | null, pi: string | null) => core.execute(
      `INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, stripe_event_id, stripe_session_id, stripe_pi_id, created_at)
       VALUES ('t-schema', 1, 'card', 26500, '2026-12-20', 'stripe_webhook', ?, ?, ?, ?)`, [ev, ss, pi, NOW]);
    await ins('evt_1', 'cs_1', 'pi_1');
    await expect(ins('evt_1', 'cs_2', 'pi_2')).rejects.toThrow(/UNIQUE/i);
    await expect(ins('evt_2', 'cs_1', 'pi_2')).rejects.toThrow(/UNIQUE/i);
    await expect(ins('evt_2', 'cs_2', 'pi_1')).rejects.toThrow(/UNIQUE/i);
    await ins(null, null, null); await ins(null, null, null); await ins(null, null, null);
  });
  it('checkouts の stripe_session_id、mail_log の dedupe_key、people の ext_ref も同じ（NULL は何個でも）', async () => {
    const co = (ss: string | null) => core.execute(
      `INSERT INTO recital_checkouts (event_key, household_id, stripe_session_id, amount, status, created_at) VALUES ('t-schema', 9, ?, 1, 'closed', ?)`, [ss, NOW]);
    await co('cs_x'); await expect(co('cs_x')).rejects.toThrow(/UNIQUE/i); await co(null); await co(null);
    const ml = (k: string | null) => core.execute(
      `INSERT INTO recital_mail_log (event_key, household_id, mail_kind, dedupe_key, status, created_at) VALUES ('t-schema', 1, 'complete', ?, 'sent', ?)`, [k, NOW]);
    await ml('complete:1'); await expect(ml('complete:1')).rejects.toThrow(/UNIQUE/i); await ml(null); await ml(null);
    let seq = 0;
    const pp = (ev: string, ext: string | null) => core.execute(
      `INSERT INTO recital_people (event_key, seq, category, last_name, ext_ref, created_at) VALUES (?, ?, 'student', 'ヤマダ', ?, ?)`, [ev, ++seq, ext, NOW]);
    await pp('t-schema', 'M1'); await expect(pp('t-schema', 'M1')).rejects.toThrow(/UNIQUE/i);
    await pp('t-schema2', 'M1'); await pp('t-schema', null); await pp('t-schema', null);
  });
});

describe('(d) payments の CHECK（世帯か注文のどちらか1つ）', () => {
  const ins = (hh: number | null, to: number | null) => core.execute(
    `INSERT INTO recital_payments (event_key, household_id, ticket_order_id, method, amount, paid_on, source, created_at)
     VALUES ('t-schema-ck', ?, ?, 'cash', 1000, '2026-12-20', 'manual', ?)`, [hh, to, NOW]);
  it('両方 NULL は弾く', async () => { await expect(ins(null, null)).rejects.toThrow(/CHECK/i); });
  it('両方入っているのも弾く', async () => { await expect(ins(1, 1)).rejects.toThrow(/CHECK/i); });
  it('片方だけなら入る', async () => { await expect(ins(1, null)).resolves.toBeDefined(); await expect(ins(null, 1)).resolves.toBeDefined(); });
});
