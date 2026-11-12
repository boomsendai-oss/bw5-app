// BW6 発表会（段階1）の DB 試験の下ごしらえ。*.test.ts ではないので単独では回らない。
// '../db' は環境変数（試験用のファイル DB）を先に入れるため、必ず関数の中で await import する。
// 試験は自分の event_key（t-xxx）の行だけを見る。台帳SQLを全部流すので種の bw6-test の行も入っている。
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/** .env.local などに書かれた TURSO_DATABASE_URL（本番の向け先）。読めなければ空。 */
function envFileDbUrls(): string[] {
  const out: string[] = [];
  for (const f of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    let text = '';
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const line of text.split('\n')) {
      const m = /^\s*(?:export\s+)?TURSO_DATABASE_URL\s*=\s*(.*)$/.exec(line);
      if (m) out.push(m[1].trim().replace(/^['"]|['"]$/g, ''));
    }
  }
  return out;
}

/**
 * 試験用の DB を用意し、initDb と台帳SQLを全部（名前順に）流す。
 * ふだんは ./data/test_recital_<name>.db を作り直す。
 * RECITAL_TEST_DB_URL（と RECITAL_TEST_DB_TOKEN）があれば、その DB（Turso の試しの DB）に向ける。
 * その DB は消さないので、毎回空の試しの DB を渡す。本番の向け先（TURSO_DATABASE_URL）と同じなら止める。
 */
export async function setupRecitalTestDb(name: string): Promise<void> {
  const remote = (process.env.RECITAL_TEST_DB_URL ?? '').trim();
  if (remote !== '') {
    const prod = [process.env.TURSO_DATABASE_URL ?? '', ...envFileDbUrls()].map((u) => u.trim()).filter((u) => u !== '');
    if (prod.includes(remote)) throw new Error('setupRecitalTestDb: RECITAL_TEST_DB_URL が TURSO_DATABASE_URL（本番）と同じです');
    process.env.TURSO_DATABASE_URL = remote;
    if (process.env.RECITAL_TEST_DB_TOKEN) process.env.TURSO_AUTH_TOKEN = process.env.RECITAL_TEST_DB_TOKEN;
    else delete process.env.TURSO_AUTH_TOKEN;
    delete process.env.SKIP_DB_INIT;
  } else {
    const file = `./data/test_recital_${name}.db`;
    process.env.TURSO_DATABASE_URL = `file:${file}`;
    delete process.env.TURSO_AUTH_TOKEN;
    delete process.env.SKIP_DB_INIT;
    for (const s of ['', '-shm', '-wal']) { try { rmSync(file + s); } catch { /* 初回は無い */ } }
  }
  const core = await import('../db');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
}

const SEED_SETTINGS: Record<string, string> = {
  entry_open_at: '2026-11-01 00:00',
  pay_open_at: '2026-11-01 00:00',
  pay_ok_at: '2026-11-01 00:00',
  suspended: '0',
  stripe_mode: 'test',
  test_mail_to: 'test@example.com',
  mail_bcc_staff: '0',
  bank_text: 'TEST-BANK-TEXT',
  consent_items: '同意の文（試し）',
};

// 設計書 03 3-4 の規則の表そのまま
const SEED_FEE_RULES: [string, string, number, number | null, number, number, string][] = [
  ['first', 'base', 1, 1, 16000, 1, '出演料（本体）'],
  ['first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ'],
  ['first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚'],
  ['first', 'add_work', 2, 2, 6000, 1, '2作品目'],
  ['first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）'],
  ['family', 'base', 1, 1, 5000, 1, 'ご家族の参加費'],
  ['family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ'],
  ['family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）'],
];

type SeedWork = { code: string; fee: string; mode: string; status: string; extraFee: number | null };
const SEED_WORKS: SeedWork[] = [
  ...['W01', 'W02', 'W03', 'W04', 'W05', 'W06', 'W07'].map((code) => ({ code, fee: 'counted', mode: 'form', status: 'open', extraFee: null })),
  { code: 'W08', fee: 'not_counted', mode: 'form', status: 'open', extraFee: null },
  { code: 'W09', fee: 'counted', mode: 'form', status: 'draft', extraFee: null },
  { code: 'W10', fee: 'counted', mode: 'staff', status: 'open', extraFee: null },
  { code: 'W11', fee: 'extra', mode: 'form', status: 'open', extraFee: 3000 },
  { code: 'W12', fee: 'separate', mode: 'none', status: 'open', extraFee: null },
];

/** 発表会1つ・設定・料金の規則8行・作品12本（W01〜W12）を入れる。返り値は work_code → id。 */
export async function seedRecitalTestEvent(
  eventKey: string,
  opts?: { isTest?: 0 | 1; settings?: Record<string, string> },
): Promise<{ workIds: Record<string, number> }> {
  const core = await import('../db');
  const now = new Date().toISOString();
  await core.execute(
    `INSERT INTO recital_events (event_key, title, show_date, rehearsal_date, venue, is_test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [eventKey, '試し', '2027-04-11', '2027-04-10', '若林区文化センター', opts?.isTest ?? 1, now],
  );
  const settings = { ...SEED_SETTINGS, ...(opts?.settings ?? {}) };
  for (const [key, value] of Object.entries(settings)) {
    await core.execute(
      `INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value`,
      [eventKey, key, value, now],
    );
  }
  for (const [i, [role, item, from, to, unit, qty, label]] of SEED_FEE_RULES.entries()) {
    await core.execute(
      `INSERT INTO recital_fee_rules (event_key, payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [eventKey, role, item, from, to, unit, qty, label, i + 1, now],
    );
  }
  const workIds: Record<string, number> = {};
  for (const [i, w] of SEED_WORKS.entries()) {
    const r = await core.execute(
      `INSERT INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, extra_fee, status, sort_order, created_at)
       VALUES (?, ?, 'class', ?, ?, ?, ?, ?, ?, ?)`,
      [eventKey, w.code, `作品${String.fromCharCode(65 + i)}`, w.mode, w.fee, w.extraFee, w.status, i + 1, now],
    );
    workIds[w.code] = Number(r.lastInsertRowid);
  }
  return { workIds };
}

/** 世帯1つ・人1人・W01 への出演1つ・（total>0 なら）base の請求1行。返り値は世帯の id。 */
export async function seedHousehold(
  eventKey: string,
  opts: { total: number; cast: 'in' | 'maybe' | 'out'; payMethod?: string | null },
): Promise<number> {
  const core = await import('../db');
  const now = new Date().toISOString();
  const hs = await core.getOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_households WHERE event_key = ?', [eventKey]);
  const seq = Number(hs.n);
  const h = await core.execute(
    `INSERT INTO recital_households (event_key, seq, ref_code, contact_last_name, contact_first_name, contact_last_kana, contact_first_kana, email, edit_token, source, pay_method, status, applied_at, created_at)
     VALUES (?, ?, ?, 'テスト', 'ハナ', 'テスト', 'ハナ', ?, ?, 'form', ?, 'active', ?, ?)`,
    [eventKey, seq, String(1000 + seq), `h${seq}@example.com`, randomBytes(24).toString('hex'), opts.payMethod ?? null, now, now],
  );
  const householdId = Number(h.lastInsertRowid);
  const ps = await core.getOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_people WHERE event_key = ?', [eventKey]);
  const p = await core.execute(
    `INSERT INTO recital_people (event_key, seq, household_id, category, last_name, first_name, last_kana, first_kana, birthday, status, created_at)
     VALUES (?, ?, ?, 'student', 'テスト', 'ハナ', 'テスト', 'ハナ', '2015-01-01', 'active', ?)`,
    [eventKey, Number(ps.n), householdId, now],
  );
  const personId = Number(p.lastInsertRowid);
  const w = await core.getOne("SELECT id FROM recital_works WHERE event_key = ? AND work_code = 'W01'", [eventKey]);
  await core.execute(
    `INSERT INTO recital_casts (event_key, person_id, work_id, status, source, applied_at, created_at) VALUES (?, ?, ?, ?, 'form', ?, ?)`,
    [eventKey, personId, Number(w.id), opts.cast, now, now],
  );
  if (opts.total > 0) {
    await core.execute(
      `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at)
       VALUES (?, ?, ?, 'base', '', '出演料（本体）', 1, ?, ?, 'active', ?)`,
      [eventKey, householdId, personId, opts.total, opts.total, now],
    );
  }
  return householdId;
}
