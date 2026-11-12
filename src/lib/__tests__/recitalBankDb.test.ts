// BW6 発表会（段階1）の recitalBankDb.ts（束を入れる・自動で当てる）の試験（実 DB・試験用のファイル DB）。Task 27。
// 自分の t-bank-* の発表会だけを見る（種の bw6-test の行を数に入れない）。名前・番号はすべて作り物。
// メールの鍵を消してから読む（送れない時は 10 の「鍵が無い」で failed。夜の「待ち」の判定はその前に通る）。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setupRecitalTestDb } from './recitalTestSeed';
import type { BankBatchIn, BankBatchRowIn } from '../recitalBankBatch';

// decideRow は本物のまま。書き込みの中の守り（not_active）の試験だけ、1回だけ返りを差しかえる
vi.mock('@/lib/recitalBankMatch', async (orig) => {
  const real = await orig<typeof import('../recitalBankMatch')>();
  return { ...real, decideRow: vi.fn(real.decideRow) };
});

delete process.env.GMAIL_APP_PASSWORD;
await setupRecitalTestDb('bank');
const { getOne, getAll, execute } = await import('../db');
const { getRecitalSettings, saveRecitalSetting } = await import('../recitalDb');
const { readHouseholdMoney } = await import('../recitalMoneyDb');
const { buildRowKey } = await import('../recitalBankBatch');
const { pickRef } = await import('../recitalRef');
const bankDb = await import('../recitalBankDb');
const { ingestBankBatch, bankStartDate, loadMatchHouseholds } = bankDb;
const { decideRow } = await import('../recitalBankMatch');

const r = (pos: string, date: string, dir: 'in' | 'out', amount: number | null, balance: number | null, kind: 'transfer' | 'debit' | 'other', desc = '', over: Partial<BankBatchRowIn> = {}): BankBatchRowIn =>
  ({ pos, date, dir, amount, balance, kind, desc, cut: false, unread: '', ...over });
const b = (rows: BankBatchRowIn[], over: Partial<BankBatchIn> = {}): BankBatchIn =>
  ({ event_key: 't-batch', source: 'chat', shot_on: '2026-12-16', range_from: '2026-12-14', range_to: '2026-12-16', images: 2, account: '円普通預金', rows, ...over });
// 25 の試験と同じ束。2枚。1-3 と 2-1 が重ねた同じ行。いちばん下はデビット（last の印が付かない形）
const SAMPLE = [
  r('1-1', '12/16', 'in', 26500, 153000, 'transfer', '振込　４８２３　ヤマダ　ハナコ'),
  r('1-2', '12/15', 'out', 1000, 126500, 'debit'),
  r('1-3', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
  r('2-1', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
  r('2-2', '12/14', 'out', 500, 121500, 'debit'),
  r('2-3', '12/14', 'out', 3000, 122000, 'debit'),
];

async function seedEvent(eventKey: string): Promise<void> {
  await execute(
    `INSERT INTO recital_events (event_key, title, show_date, rehearsal_date, venue, is_test, created_at) VALUES (?, '試し', '2027-04-11', '2027-04-10', '試しの会場', 1, ?)`,
    [eventKey, new Date().toISOString()],
  );
  await saveRecitalSetting(eventKey, 'pay_open_at', '2026-12-15 12:00', 'test');
  await saveRecitalSetting(eventKey, 'bank_rest_from', '2026-12-30', 'test');
  await saveRecitalSetting(eventKey, 'bank_rest_to', '2027-01-03', 'test');
  await saveRecitalSetting(eventKey, 'test_mail_to', 'test@example.com', 'test');
}

let workSeq = 0;
/** 世帯1つ・人1人・作品1つと in（か out）の出演・active の請求（charges の数だけ）。返り値は世帯の id */
async function seedHousehold(eventKey: string, o: { ref: string; lastKana: string; charges: number[]; cast?: 'in' | 'out' }): Promise<number> {
  const now = new Date().toISOString();
  const seq = Number((await getOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_households WHERE event_key = ?', [eventKey]))?.n);
  const h = await execute(
    `INSERT INTO recital_households (event_key, seq, ref_code, contact_last_name, contact_first_name, contact_last_kana, contact_first_kana, email, edit_token, source, status, applied_at, created_at)
     VALUES (?, ?, ?, '試し', '花', ?, 'ハナ', ?, ?, 'form', 'active', ?, ?)`,
    [eventKey, seq, o.ref, o.lastKana, `h${seq}@example.com`, randomBytes(24).toString('hex'), now, now],
  );
  const hid = Number(h.lastInsertRowid);
  const pseq = Number((await getOne('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM recital_people WHERE event_key = ?', [eventKey]))?.n);
  const p = await execute(
    `INSERT INTO recital_people (event_key, seq, household_id, category, last_name, first_name, last_kana, first_kana, birthday, status, created_at)
     VALUES (?, ?, ?, 'student', '試し', '花', ?, 'ハナ', '2015-01-01', 'active', ?)`,
    [eventKey, pseq, hid, o.lastKana, now],
  );
  const pid = Number(p.lastInsertRowid);
  workSeq++;
  const w = await execute(
    `INSERT INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, status, sort_order, created_at)
     VALUES (?, ?, 'class', '試しの作品', 'form', 'counted', 'open', ?, ?)`,
    [eventKey, `TB${workSeq}`, workSeq, now],
  );
  await execute(
    `INSERT INTO recital_casts (event_key, person_id, work_id, status, source, applied_at, created_at) VALUES (?, ?, ?, ?, 'form', ?, ?)`,
    [eventKey, pid, Number(w.lastInsertRowid), o.cast ?? 'in', now, now],
  );
  for (const amount of o.charges) {
    await execute(
      `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at)
       VALUES (?, ?, ?, 'base', '', '出演料（本体）', 1, ?, ?, 'active', ?)`,
      [eventKey, hid, pid, amount, amount, now],
    );
  }
  return hid;
}

/** 台帳に1行を SQL で入れる（row_key は 25 の buildRowKey で作る） */
async function insertLedgerRow(
  eventKey: string,
  over: Partial<{ row_date: string; dir: string; kind: string; amount: number; balance: number | null; source: string; state: string; check_flag: string | null; desc_raw: string | null; review_kind: string | null; ref_read: string | null; ref_ok: number }>,
): Promise<number> {
  const x = { row_date: '2026-12-16', dir: 'in', kind: 'transfer', amount: 26500, balance: 150000 as number | null, source: 'chat', state: 'new', check_flag: null, desc_raw: null, review_kind: null, ref_read: null, ref_ok: 0, ...over };
  const rowKey = buildRowKey({ rowDate: x.row_date, dir: x.dir, amount: x.amount, balance: x.balance });
  const res = await execute(
    `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, balance, kind, desc_raw, ref_read, ref_ok, row_key, source, state, check_flag, review_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [eventKey, new Date().toISOString(), x.row_date, x.dir, x.amount, x.balance, x.kind, x.desc_raw, x.ref_read, x.ref_ok, rowKey, x.source, x.state, x.check_flag, x.review_kind],
  );
  return Number(res.lastInsertRowid);
}

/** 4 の pickRef で検査に合う番号を12個 */
async function twelveRefs(): Promise<string[]> {
  const used = new Set<string>();
  for (let i = 0; i < 12; i++) used.add(pickRef(used, [], () => 0.5)!);
  return [...used];
}

/**
 * はじめの5件をすませた形にする：作り物の世帯に、bank_auto のプラスの入金を5つの台帳の行で入れる。
 * 台帳の行は kind='other'（開始日・つなぎ目の検算に数えない形。この試験では数だけが要る）
 */
async function fillFirst5(eventKey: string): Promise<void> {
  const hid = await seedHousehold(eventKey, { ref: '9999', lastKana: 'スズキ', charges: [5] });
  for (let i = 0; i < 5; i++) {
    const rowId = await insertLedgerRow(eventKey, { row_date: '2026-12-01', kind: 'other', amount: 1, balance: 1000 + i, state: 'matched' });
    await execute(
      `INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, bank_transaction_id, created_at) VALUES (?, ?, 'bank', 1, '2026-12-01', 'bank_auto', ?, ?)`,
      [eventKey, hid, rowId, new Date().toISOString()],
    );
  }
}

const count = async (sql: string, args: (string | number)[]) => Number((await getOne(sql, args))?.n);

describe('ingestBankBatch', () => {
  const NOON = new Date('2026-12-16T12:00:00+09:00');
  // ev ごとに seedEvent。A＝4823 ヤマダ 26,500
  it('合う束を commit：台帳に全部入り、5件がたまっていれば、ぴったりの行が自動で当たる', async () => {
    const ev = 't-bank-1'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const res = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res).toMatchObject({ mode: 'commit', check: { ok: true }, read_rows: 5, inserted: 5, existing: 0, rejected: 0, auto_matched: 1 });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
    const row = await getOne(`SELECT state, match_by, row_date FROM recital_bank_rows WHERE event_key=? AND ref_read='4823'`, [ev]);
    expect(row).toMatchObject({ state: 'matched', match_by: 'auto', row_date: '2026-12-16' });
    const mail = await getOne(`SELECT dedupe_key, status FROM recital_mail_log WHERE household_id=? AND dedupe_key LIKE 'bank_paid:%'`, [A]);
    expect(['sent', 'failed']).toContain(mail?.status); // 昼は待ちにしない（試しの宛先が空なら failed）
  });
  it('同じ束を2回渡しても、行も入金も増えない（束の記録は2行）', async () => {
    const ev = 't-bank-2'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const bb = { ...b(SAMPLE, { event_key: ev }), first_ok: true };
    await ingestBankBatch(bb, 'commit', 'test', NOON);
    const again = await ingestBankBatch(bb, 'commit', 'test', NOON);
    expect(again).toMatchObject({ inserted: 0, existing: 5, auto_matched: 0 });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?`, [ev]))?.n).toBe(5);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE event_key=?`, [ev]))?.n).toBe(1);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_imports WHERE event_key=?`, [ev]))?.n).toBe(2);
  });
  it('合わない束：1行も入れず、束の記録は残る（commit は読んだ行を rejected に）', async () => {
    const ev = 't-bank-3'; await seedEvent(ev);
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    const res = await ingestBankBatch(b(bad, { event_key: ev }), 'commit', 'test', NOON);
    expect(res.check).toEqual({ ok: false, near: '残高がつながりません：12月16日の 26,500円の行のあたり', lastOkDate: null });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?`, [ev]))?.n).toBe(0);
    expect(await getOne(`SELECT inserted, rejected, read_rows, check_result FROM recital_imports WHERE event_key=?`, [ev]))
      .toMatchObject({ inserted: 0, rejected: 5, read_rows: 5, check_result: 'ng:12/16:26500' });
  });
  it('dry：合えば何も残さない／合わなければ束の記録に日時・source・check_result だけ', async () => {
    const ev = 't-bank-4'; await seedEvent(ev);
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'dry', 'test', NOON);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_imports WHERE event_key=?`, [ev]))?.n).toBe(0);
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    await ingestBankBatch(b(bad, { event_key: ev }), 'dry', 'test', NOON);
    expect(await getOne(`SELECT read_rows, inserted, shot_on, check_result, source FROM recital_imports WHERE event_key=?`, [ev]))
      .toMatchObject({ read_rows: 0, inserted: 0, shot_on: null, check_result: 'ng:12/16:26500', source: 'chat' });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?`, [ev]))?.n).toBe(0);
  });
  it('はじめの5件：first_ok なしの commit では当てず first5 で待つ → はいの束で、待っていた行も当たる', async () => {
    const ev = 't-bank-5'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const dry = await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'dry', 'test', NOON);
    expect(dry.needs_first_ok).toBe(true);
    expect(dry.first5_rows).toEqual([{ pos: '1-1', ref: '4823', amount: 26500, conditions: [true, true, true, true, true] }, expect.objectContaining({ pos: '1-3', ref: '4867' })]);
    const c1 = await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', NOON);
    expect(c1).toMatchObject({ auto_matched: 0, review: { first5: 1 } });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(26500);
    const c2 = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(c2).toMatchObject({ inserted: 0, auto_matched: 1 });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
  });
  it('開始日：manual の 12/19 があっても、chat の 12/18 の日（manual は数えない）／台帳が空なら pay_open_at と pay_ok_at の遅い方の前の日', async () => {
    const ev = 't-bank-sd'; await seedEvent(ev);
    expect(await bankStartDate(ev, await getRecitalSettings(ev))).toBe('2026-12-14');   // pay_open_at 12/15 12:00・pay_ok_at 空
    await saveRecitalSetting(ev, 'pay_open_at', '2026-12-15 12:00', 'test');
    await execute(`INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, 'pay_ok_at', '2026-12-17 09:00', ?) ON CONFLICT(event_key,key) DO UPDATE SET value=excluded.value`, [ev, new Date().toISOString()]);
    expect(await bankStartDate(ev, await getRecitalSettings(ev))).toBe('2026-12-16');
    await insertLedgerRow(ev, { row_date: '2026-12-18', source: 'chat' }); await insertLedgerRow(ev, { row_date: '2026-12-19', source: 'manual' });
    expect(await bankStartDate(ev, await getRecitalSettings(ev))).toBe('2026-12-18');
  });
  it('はいの束で、前の束から first5 で待っていて今回の束に写っていない行も当たる（2-23）', async () => {
    const ev = 't-bank-5b'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', NOON);                       // 4823 の 12/16 の行は first5 で待つ
    const day2 = [r('1-1', '12/18', 'in', 5000, 158000, 'transfer', '振込 ﾀﾅｶ ｲﾁﾛｳ'), r('1-2', '12/16', 'in', 26500, 153000, 'transfer', '振込　４８２３　ヤマダ　ハナコ')];
    await ingestBankBatch(b(day2, { event_key: ev }), 'commit', 'test', new Date('2026-12-18T12:00:00+09:00'));   // 開始日は 12/18 になる
    const day3 = [r('1-1', '12/19', 'out', 1000, 157000, 'debit'), r('1-2', '12/18', 'in', 5000, 158000, 'transfer', '振込 ﾀﾅｶ ｲﾁﾛｳ')];  // 4823 の行は写っていない
    const dry = await ingestBankBatch(b(day3, { event_key: ev }), 'dry', 'test', new Date('2026-12-19T12:00:00+09:00'));
    expect(dry.first5_rows?.map((x) => x.ref)).toContain('4823');                                         // 台帳の first5 の行は全部見せる
    expect(dry.first5_rows?.find((x) => x.ref === '4823')?.pos).toMatch(/^ledger-\d+$/);
    expect(dry.needs_first_ok).toBe(true);
    await ingestBankBatch({ ...b(day3, { event_key: ev }), first_ok: true }, 'commit', 'test', new Date('2026-12-19T12:00:00+09:00'));
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
  });
  it('出金・デビットは新しい束の行で入れかえる／振込の入金は入れかえない', async () => {
    const ev = 't-bank-6'; await seedEvent(ev);
    // 1日目：12/16 デビット 1,000（残高 125,500）と、いちばん下に 12/15 デビット 500（残高 126,500）
    await ingestBankBatch({ ...b([r('1-1', '12/16', 'out', 1000, 125500, 'debit'), r('1-2', '12/15', 'out', 500, 126500, 'debit')], { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    await insertLedgerRow(ev, { row_date: '2026-12-16', source: 'manual', dir: 'in', kind: 'transfer', amount: 3000, balance: null });
    // 2日目：同じ 12/16 のデビットが 1,200（残高 125,300）で出た。いちばん下は台帳にある 12/15 の行
    await ingestBankBatch({ ...b([r('1-1', '12/16', 'out', 1200, 125300, 'debit'), r('1-2', '12/15', 'out', 500, 126500, 'debit')], { event_key: ev }), first_ok: true }, 'commit', 'test', new Date('2026-12-17T12:00:00+09:00'));
    const rows = await getAll(`SELECT amount, dir, source, state FROM recital_bank_rows WHERE event_key=? AND row_date='2026-12-16' ORDER BY id`, [ev]);
    expect(rows).toEqual([
      { amount: 1000, dir: 'out', source: 'chat', state: 'void' },
      { amount: 3000, dir: 'in', source: 'manual', state: 'new' },
      { amount: 1200, dir: 'out', source: 'chat', state: 'new' },
    ]);
  });
  it('1/4 に渡した束の 12/29 の行は 2026年', async () => {
    const ev = 't-bank-7'; await seedEvent(ev);
    await ingestBankBatch(b([r('1-1', '12/29', 'out', 1000, 152000, 'debit'), r('1-2', '12/28', 'out', 500, 153000, 'debit')], { event_key: ev }), 'commit', 'test', new Date('2027-01-04T09:00:00+09:00'));
    expect((await getAll(`SELECT row_date FROM recital_bank_rows WHERE event_key=? ORDER BY row_date`, [ev])).map((x) => x.row_date)).toEqual(['2026-12-28', '2026-12-29']);
  });
  it('当てる順は古い順：同じ番号 26,500 が同じ日に2件 → 下（古い）の 1-2 が自動、上の 1-1 は paid（場面3）', async () => {
    const ev = 't-bank-8'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await insertLedgerRow(ev, { row_date: '2026-12-15', dir: 'out', kind: 'debit', amount: 1000, balance: 127000, source: 'chat' }); // 1-3 と同じ行（row_key は buildRowKey で作る）
    const rows = [
      r('1-1', '12/16', 'in', 26500, 180000, 'transfer', '振込 4823 ヤマダ ハナコ'),
      r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 4823 ヤマダ ハナコ'),
      r('1-3', '12/15', 'out', 1000, 127000, 'debit'),
    ];
    await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    const got = await getAll(`SELECT balance, state, match_by, review_kind FROM recital_bank_rows WHERE event_key=? AND dir='in' ORDER BY balance`, [ev]);
    expect(got).toEqual([
      { balance: 153500, state: 'matched', match_by: 'auto', review_kind: null },
      { balance: 180000, state: 'new', match_by: null, review_kind: 'paid' },
    ]);
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id=?`, [A]))?.n).toBe(1);
  });
  it('手で打った行と日付・金額が同じ行 → 両方に manual_twin、新しい行は当てない（場面35）', async () => {
    const ev = 't-bank-9'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await insertLedgerRow(ev, { row_date: '2026-12-16', source: 'manual', dir: 'in', kind: 'transfer', amount: 26500, balance: null, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const res = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res.auto_matched).toBe(0); expect(res.flagged).toBeGreaterThanOrEqual(1);
    expect((await getAll(`SELECT check_flag FROM recital_bank_rows WHERE event_key=? AND row_date='2026-12-16' AND dir='in'`, [ev])).map((x) => x.check_flag)).toEqual(['manual_twin', 'manual_twin']);
  });
  it('いちばん下が新しい振込の入金 → last、当てない、flagged に数える（場面34）', async () => {
    const ev = 't-bank-10'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const res = await ingestBankBatch({ ...b([r('1-1', '12/16', 'out', 1000, 152500, 'debit'), r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 4823 ヤマダ ハナコ')], { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res).toMatchObject({ auto_matched: 0, flagged: 1 });
    expect((await getOne(`SELECT check_flag FROM recital_bank_rows WHERE event_key=? AND dir='in'`, [ev]))?.check_flag).toBe('last');
  });
  it('夜 21:30 に当たった → メールの記録は waiting', async () => {
    const ev = 't-bank-11'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', new Date('2026-12-16T21:30:00+09:00'));
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE household_id=? AND dedupe_key LIKE 'bank_paid:%'`, [A]))?.status).toBe('waiting');
  });
  it('1つの束で当たった行が10件をこえたら、11件目からのメールは waiting（関数は60秒まで）', async () => {
    const ev = 't-bank-12'; await seedEvent(ev);
    const refs = await twelveRefs();                       // 試験の中の小さな関数：pickRef で検査に合う番号を12個
    const hs = [] as number[]; for (const ref of refs) hs.push(await seedHousehold(ev, { ref, lastKana: 'ヤマダ', charges: [26500] }));
    // 新しい順に12行（残高は下から 26,500 ずつふえる）＋いちばん下にデビット1行
    const rows = refs.map((ref, i) => r(`1-${i + 1}`, '12/16', 'in', 26500, 126500 + 26500 * (12 - i), 'transfer', `振込 ${ref} ヤマダ ハナコ`)).concat(r('1-13', '12/15', 'out', 1000, 126500, 'debit'));
    await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    const st = (await getAll(`SELECT status FROM recital_mail_log WHERE event_key=? AND dedupe_key LIKE 'bank_paid:%'`, [ev])).map((x) => x.status);
    expect(st).toHaveLength(12);
    expect(st.filter((x) => x === 'waiting')).toHaveLength(2);
  });
  it('返す物に名義が入らない', async () => {
    const res = await ingestBankBatch(b(SAMPLE, { event_key: 't-bank-1' }), 'dry', 'test', NOON);
    expect(JSON.stringify(res)).not.toMatch(/ヤマダ|ﾔﾏﾀﾞ/);
  });
  it('発表会が無い → no_event', async () => {
    await expect(ingestBankBatch(b(SAMPLE, { event_key: 't-bank-none' }), 'dry', 'test', NOON)).rejects.toThrow('no_event');
  });
});

describe('ingestBankBatch：Task 26 の見直しから持ち越した約束', () => {
  const NOON = new Date('2026-12-16T12:00:00+09:00');
  it('(a) 1つの束で同じ番号・同じ金額が2行：dry でも、1行目で当たった世帯の残りを減らしてから2行目を見る（2行目は paid）。dry は何も書かない', async () => {
    const ev = 't-bank-a'; await seedEvent(ev); await fillFirst5(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await insertLedgerRow(ev, { row_date: '2026-12-15', dir: 'out', kind: 'debit', amount: 1000, balance: 127000, source: 'chat' });
    const rows = [
      r('1-1', '12/16', 'in', 26500, 180000, 'transfer', '振込 4823 ヤマダ ハナコ'),
      r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 4823 ヤマダ ハナコ'),
      r('1-3', '12/15', 'out', 1000, 127000, 'debit'),
    ];
    const before = { rows: await count('SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?', [ev]), pays: await count('SELECT COUNT(*) n FROM recital_payments WHERE event_key=?', [ev]) };
    const dry = await ingestBankBatch(b(rows, { event_key: ev }), 'dry', 'test', NOON);
    expect(dry).toMatchObject({ inserted: 2, existing: 1, auto_matched: 1, review: { paid: 1 }, needs_first_ok: false });
    expect(dry.first5_rows).toBeUndefined();                                                         // 5件はすんでいる
    expect(await count('SELECT COUNT(*) n FROM recital_bank_rows WHERE event_key=?', [ev])).toBe(before.rows);
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE event_key=?', [ev])).toBe(before.pays);
    expect(await count('SELECT COUNT(*) n FROM recital_imports WHERE event_key=?', [ev])).toBe(0);
    // first_ok なしの commit でも、5件がすんでいれば当たる。2行目は当てない
    const c = await ingestBankBatch(b(rows, { event_key: ev }), 'commit', 'test', NOON);
    expect(c).toMatchObject({ auto_matched: 1, review: { paid: 1 } });
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [A])).toBe(1);
    expect((await readHouseholdMoney(A)).m).toMatchObject({ remaining: 0, overpaid: 0 });
  });
  it('(b) 行そのものを「足すとぴったり」の材料に入れない：13,250 の1行だけなら sum でなく short', async () => {
    const ev = 't-bank-b'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const rows = [r('1-1', '12/16', 'in', 13250, 140250, 'transfer', '振込 4823 ヤマダ ハナコ'), r('1-2', '12/15', 'out', 1000, 127000, 'debit')];
    const dry = await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'dry', 'test', NOON);
    expect(dry.review).toEqual({ short: 1 });
    const c = await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(c.review).toEqual({ short: 1 });
    expect((await getOne(`SELECT review_kind FROM recital_bank_rows WHERE event_key=? AND dir='in'`, [ev]))?.review_kind).toBe('short');
  });
  it('(b) 同じ番号のほかの待っている行は材料に入る：13,250 が2行 → 古い方は sum', async () => {
    const ev = 't-bank-b2'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const rows = [
      r('1-1', '12/16', 'in', 13250, 153500, 'transfer', '振込 4823 ヤマダ ハナコ'),
      r('1-2', '12/16', 'in', 13250, 140250, 'transfer', '振込 4823 ヤマダ タロウ'),
      r('1-3', '12/15', 'out', 1000, 127000, 'debit'),
    ];
    const c = await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(c.review).toEqual({ sum: 2 });
  });
  it('(c) まとめた世帯の番号・出演なしの世帯の番号は gone（bad_ref にしない）', async () => {
    const ev = 't-bank-c'; await seedEvent(ev);
    const target = await seedHousehold(ev, { ref: '4867', lastKana: 'ヤマダ', charges: [26500] });
    const merged = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [target, merged]);
    await seedHousehold(ev, { ref: '4872', lastKana: 'ヤマダ', charges: [26500], cast: 'out' });
    const rows = [
      r('1-1', '12/16', 'in', 26500, 180000, 'transfer', '振込 4823 ヤマダ ハナコ'),
      r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 4872 ヤマダ ハナコ'),
      r('1-3', '12/15', 'out', 1000, 127000, 'debit'),
    ];
    const c = await ingestBankBatch({ ...b(rows, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(c).toMatchObject({ auto_matched: 0, review: { gone: 2 } });
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE event_key=?', [ev])).toBe(0);
    const all = await loadMatchHouseholds(ev);
    expect(all.map((h) => [h.refCode, h.status, h.mergedInto, h.view])).toEqual([
      ['4867', 'active', null, 'tentative'],
      ['4823', 'merged', target, 'tentative'],
      ['4872', 'active', null, 'none'],
    ]);
  });
  it('loadMatchHouseholds：姓は人の last_kana 全部＋contact_last_kana、told は金額がある時だけ、合計が下がった前の合計', async () => {
    const ev = 't-bank-load'; await seedEvent(ev);
    const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await execute(`UPDATE recital_households SET contact_last_kana='サトウ', bank_told_at='2026-12-16T00:00:00.000Z', bank_told_date='2026-12-16', bank_told_name='サトウ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [A]);
    const now = new Date().toISOString();
    for (const [bf, af] of [[35500, 32500], [32500, 38500], [38500, 26500], [26500, 29500]]) {
      await execute(`INSERT INTO recital_changes (event_key, household_id, action, before_json, after_json, actor, is_exception, created_at) VALUES (?, ?, 'total_changed', ?, ?, 'test', 0, ?)`,
        [ev, A, JSON.stringify({ total: bf }), JSON.stringify({ total: af }), now]);
    }
    const [h] = await loadMatchHouseholds(ev);
    expect(h).toMatchObject({ id: A, refCode: '4823', status: 'active', remaining: 26500, totalBeforeLastDrop: 38500, told: { date: '2026-12-16', name: 'サトウ ハナコ', amount: 26500 } });
    expect([...h.surnamesKana].sort()).toEqual(['サトウ', 'ヤマダ']);
  });
});

describe('ingestBankBatch：見直し1回目', () => {
  const NOON = new Date('2026-12-16T12:00:00+09:00');
  afterEach(() => { vi.restoreAllMocks(); });
  // 2世帯（4823・4867）にぴったりの2行。いちばん下はデビット
  const two = [
    r('1-1', '12/16', 'in', 6000, 159500, 'transfer', '振込 4867 ヤマダ タロウ'),
    r('1-2', '12/16', 'in', 26500, 153500, 'transfer', '振込 4823 ヤマダ ハナコ'),
    r('1-3', '12/15', 'out', 1000, 127000, 'debit'),
  ];

  it('1行が当てる途中で失敗：ほかの行は当たってメールも出て、最後に match_failed／同じ束を渡し直すと、残った行が当たり、当たった行は2回記録しない', async () => {
    const ev = 't-bank-r1'; await seedEvent(ev);
    const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const B = await seedHousehold(ev, { ref: '4867', lastKana: 'ヤマダ', charges: [6000] });
    // 古い順に当てるので、1回目の呼び出しは 1-2（4823）。それだけを止まった形にする
    vi.spyOn(bankDb.__internal, 'matchOneRow').mockRejectedValueOnce(new Error('recital_test:stop'));
    await expect(ingestBankBatch({ ...b(two, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON)).rejects.toThrow('recital_bank:match_failed');
    expect(await getOne(`SELECT state, review_kind, check_flag FROM recital_bank_rows WHERE event_key=? AND ref_read='4823'`, [ev])).toEqual({ state: 'new', review_kind: null, check_flag: null });
    expect((await readHouseholdMoney(B)).m.remaining).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM recital_mail_log WHERE household_id=? AND dedupe_key LIKE 'bank_paid:%'`, [B])).toBe(1);
    expect((await readHouseholdMoney(A)).m.remaining).toBe(26500);
    vi.restoreAllMocks();
    // 渡し直し：dry でも当たる見込みに出る → commit で当たる
    const dry = await ingestBankBatch({ ...b(two, { event_key: ev }), first_ok: true }, 'dry', 'test', NOON);
    expect(dry).toMatchObject({ inserted: 0, existing: 3, auto_matched: 0, review: { first5: 1 } }); // dry は first_ok を付けずに見る（はじめの5件の間）
    const again = await ingestBankBatch({ ...b(two, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(again).toMatchObject({ inserted: 0, existing: 3, auto_matched: 1 });
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [A])).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [B])).toBe(1);
  });

  it('書き込みの中の守り：自動と決まっても、世帯がまとめた世帯なら入金を作らない（recital_bank:not_active）', async () => {
    const ev = 't-bank-na'; await seedEvent(ev);
    const target = await seedHousehold(ev, { ref: '4867', lastKana: 'ヤマダ', charges: [26500] });
    const merged = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [target, merged]);
    vi.mocked(decideRow).mockReturnValueOnce({ auto: true, householdId: merged });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON)).rejects.toThrow('recital_bank:match_failed');
    expect(err.mock.calls.some((c) => c.includes('recital_bank:not_active'))).toBe(true);
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE event_key=?', [ev])).toBe(0);
    expect(await getOne(`SELECT state FROM recital_bank_rows WHERE event_key=? AND ref_read='4823'`, [ev])).toEqual({ state: 'new' });
  });

  it('重なる日の撮り直しで、同じ番号・同じ日・同じ金額の入金が残高だけちがって入る → twin の印、自動で当てない', async () => {
    const ev = 't-bank-tw'; await seedEvent(ev); await fillFirst5(ev);
    // 1日目：4823 の世帯はまだ無い（bad_ref で待つ）
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', NOON);
    const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    // 2日目：12/16 の入金の下に 12/16 のデビットが写り、入金の行の残高が 153,000 → 152,000 に変わった
    const day2 = [
      r('1-1', '12/16', 'in', 26500, 152000, 'transfer', '振込　４８２３　ヤマダ　ハナコ'),
      r('1-2', '12/16', 'out', 1000, 125500, 'debit'),
      r('1-3', '12/15', 'out', 1000, 126500, 'debit'),
      r('1-4', '12/15', 'in', 6000, 127500, 'transfer', '振込 4867 ヤマダ タロウ'),
    ];
    const dry = await ingestBankBatch(b(day2, { event_key: ev }), 'dry', 'test', new Date('2026-12-17T12:00:00+09:00'));
    expect(dry).toMatchObject({ check: { ok: true }, inserted: 2, auto_matched: 0, flagged: 1 });
    const res = await ingestBankBatch(b(day2, { event_key: ev }), 'commit', 'test', new Date('2026-12-17T12:00:00+09:00'));
    expect(res).toMatchObject({ auto_matched: 0, flagged: 1 });
    expect(await getOne(`SELECT check_flag, state FROM recital_bank_rows WHERE event_key=? AND balance=152000`, [ev])).toEqual({ check_flag: 'twin', state: 'new' });
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [A])).toBe(0);
  });

  it('残高が読めない行で合わない → わけを言う', async () => {
    const ev = 't-bank-bu'; await seedEvent(ev);
    const rows = SAMPLE.map((x) => (x.pos === '1-2' ? { ...x, balance: null, unread: 'balance' } : x));
    const res = await ingestBankBatch(b(rows, { event_key: ev }), 'dry', 'test', NOON);
    expect(res.check).toEqual({ ok: false, near: '残高が読めない行があります（入出金明細の一覧の画面で撮ってください）：12月15日の 1,000円の行のあたり', lastOkDate: null });
  });

  it('期間の開始日で合わない（range_from が / の形でも）→ 開始日の文', async () => {
    const ev = 't-bank-st'; await seedEvent(ev);
    const res = await ingestBankBatch(b(SAMPLE, { event_key: ev, range_from: '2026/12/16' }), 'dry', 'test', NOON);
    expect(res.check).toEqual({ ok: false, near: '12月14日（期間の開始日）', lastOkDate: null });
    expect((await getOne(`SELECT check_result FROM recital_imports WHERE event_key=?`, [ev]))?.check_result).toBe('ng:12/14:0');
  });
});
