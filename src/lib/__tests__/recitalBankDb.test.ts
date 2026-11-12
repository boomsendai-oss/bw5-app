// BW6 発表会（段階1）の recitalBankDb.ts（束を入れる・自動で当てる）の試験（実 DB・試験用のファイル DB）。Task 27。
// 自分の t-bank-* の発表会だけを見る（種の bw6-test の行を数に入れない）。名前・番号はすべて作り物。
// メールの鍵を消してから読む（送れない時は 10 の「鍵が無い」で failed。夜の「待ち」の判定はその前に通る）。
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { setupRecitalTestDb } from './recitalTestSeed';
import type { BankBatchIn, BankBatchRowIn } from '../recitalBankBatch';

// decideRow は本物のまま。書き込みの中の守り（not_active）の試験だけ、1回だけ返りを差しかえる
vi.mock('@/lib/recitalBankMatch', async (orig) => {
  const real = await orig<typeof import('../recitalBankMatch')>();
  return { ...real, decideRow: vi.fn(real.decideRow) };
});

// 書き込みの失敗を作るための差し込み口（busy の試験だけ。空のときは本物の withWriteTx をそのまま通す）
const txFault = vi.hoisted(() => ({ next: null as Error | null, batch: null as Error | null }));
vi.mock('@/lib/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/db')>();
  return {
    ...real,
    withWriteTx: async <T,>(fn: Parameters<typeof real.withWriteTx<T>>[0]): Promise<T> => {
      const e = txFault.next;
      if (e) { txFault.next = null; throw e; }
      return real.withWriteTx(fn);
    },
    batch: async (...a: Parameters<typeof real.batch>) => {
      const e = txFault.batch;
      if (e) { txFault.batch = null; throw e; }
      return real.batch(...a);
    },
  };
});

delete process.env.GMAIL_APP_PASSWORD;
await setupRecitalTestDb('bank');
const { getOne, getAll, execute } = await import('../db');
const { getRecitalSettings, saveRecitalSetting } = await import('../recitalDb');
const { readHouseholdMoney } = await import('../recitalMoneyDb');
const { buildRowKey } = await import('../recitalBankBatch');
const { pickRef } = await import('../recitalRef');
const bankDb = await import('../recitalBankDb');
const { ingestBankBatch, bankStartDate, loadMatchHouseholds, listReviewRows, assignBankRow, setBankRowState, restoreBankRow, mergeManualRow, cancelBankPayment, getBankAskFacts } = bankDb;
const { recordManualPayment } = await import('../recitalMoneyDb');
const { sendPaidMail } = await import('../recitalMail');
const { readRefFromDesc } = await import('../recitalRef');
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
  // desc_raw を渡して ref_read を渡さなければ、4 の readRefFromDesc で ref_read・ref_ok を入れる
  const read = over.desc_raw != null && !('ref_read' in over) ? readRefFromDesc(over.desc_raw) : null;
  const x = {
    row_date: '2026-12-16', dir: 'in', kind: 'transfer', amount: 26500, balance: 150000 as number | null, source: 'chat', state: 'new', check_flag: null, desc_raw: null, review_kind: null,
    ref_read: read ? read.ref : null, ref_ok: read?.refOk ? 1 : 0, ...over,
  };
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

// ---------- Task 28：見てほしい入金のボタンと、入金の取り消し ----------
// この試験ファイルの中だけの小さい助け（export しない）
const o = { sendRemaining: false, confirmFlag: false };
const mailKinds = async (hid: number) => (await getAll(`SELECT mail_kind FROM recital_mail_log WHERE household_id=? ORDER BY id`, [hid])).map((x) => String(x.mail_kind));
const bankPaidMailKeys = async (hid: number) => (await getAll(`SELECT dedupe_key FROM recital_mail_log WHERE household_id=? AND dedupe_key LIKE 'bank_paid:%' ORDER BY id`, [hid])).map((x) => String(x.dedupe_key));
const mailCount = async (hid: number) => count(`SELECT COUNT(*) n FROM recital_mail_log WHERE household_id=?`, [hid]);
const rowState = async (rowId: number) => String((await getOne(`SELECT state FROM recital_bank_rows WHERE id=?`, [rowId]))?.state);
/** base の行を1つ足す（合計を n ふやす） */
async function addCharge(hid: number, n: number): Promise<void> {
  const p = await getOne(`SELECT id, event_key FROM recital_people WHERE household_id=? ORDER BY id LIMIT 1`, [hid]);
  await execute(
    `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at)
     VALUES (?, ?, ?, 'base', '', '出演料（本体）', 1, ?, ?, 'active', ?)`,
    [String(p?.event_key), hid, Number(p?.id), n, n, new Date().toISOString()],
  );
}

describe('見てほしい入金のボタン', () => {
  // 試験ごとに自分の発表会 t-bank-b<番号> と世帯・行を作る（前の試験の入金で残りがずれないように。ほかの試験の世帯・行を使わない）。
  // 世帯の番号は検査に合う欠番（4823・4867・4872・4727・9827・1234・9054。本物の家庭には出ない）。
  // assignBankRow ははじめの5件に関係しない（insertLedgerRow の行は review_kind が空なので first5 にならない）。
  const fresh = async (no: string, hh: { ref: string; kana: string; charges: number[]; cast?: 'in' | 'out' }[]) => {
    const ev = `t-bank-b${no}`; await seedEvent(ev);
    const ids: number[] = [];
    for (const h of hh) ids.push(await seedHousehold(ev, { ref: h.ref, lastKana: h.kana, charges: h.charges, cast: h.cast }));
    return { ev, ids };
  };
  it('5 金額が少ない：一部として当てる。あと◯円を送るを選ぶと remaining のメール', async () => {
    // A＝合計 32,500・払った 0。26,500 の行（short）→ 残り 6,000
    const { ev, ids: [A] } = await fresh('5s', [{ ref: '4823', kana: 'ヤマダ', charges: [32500] }]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], { sendRemaining: true, confirmFlag: false }, 'KEIKO');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(6000);
    expect(await mailKinds(A)).toContain('remaining');
  });
  it('5 送らないを選ぶと remaining のメールは出ない', async () => {
    // A＝合計 32,500。26,500 の行（short）
    const { ev, ids: [A] } = await fresh('5n', [{ ref: '4823', kana: 'ヤマダ', charges: [32500] }]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO');
    expect(await mailKinds(A)).not.toContain('remaining');
  });
  it('7 金額が多い：全額が入金、こえた 6,000 はしくみの返す分（source_payment_id 付き）', async () => {
    // A＝合計 26,500。32,500 の行（over）→ 返す分 6,000
    const { ev, ids: [A] } = await fresh('7', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }]);
    const row = await insertLedgerRow(ev, { amount: 32500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds } = await assignBankRow(row, [{ householdId: A, amount: 32500 }], o, 'KEIKO');
    expect(await getOne(`SELECT amount, status, reason_no, source_payment_id FROM recital_refunds WHERE household_id=?`, [A]))
      .toMatchObject({ amount: 6000, status: 'todo', reason_no: 1, source_payment_id: paymentIds[0] });
  });
  it('4 足すとぴったり：1回押すと両方当たり、メールは1通（新しい方の入金の鍵）', async () => {
    // A＝合計 32,500。同じ番号の 26,500 と 6,000 の行（足すと 32,500＝sum）
    const { ev, ids: [A] } = await fresh('4', [{ ref: '4823', kana: 'ヤマダ', charges: [32500] }]);
    const row26500 = await insertLedgerRow(ev, { amount: 26500, balance: 150000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await insertLedgerRow(ev, { amount: 6000, balance: 156000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds } = await assignBankRow(row26500, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(paymentIds).toHaveLength(2);
    expect(await bankPaidMailKeys(A)).toEqual([`bank_paid:${Math.max(...paymentIds)}`]);
  });
  it('9 2つの世帯に分ける：合計が行の額でなければ通さない／合えば入金2行', async () => {
    // A・B＝合計 26,500 ずつ。53,000 の行
    const { ev, ids: [A, B] } = await fresh('9', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }, { ref: '4867', kana: 'スズキ', charges: [26500] }]);
    const row53000 = await insertLedgerRow(ev, { amount: 53000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await expect(assignBankRow(row53000, [{ householdId: A, amount: 26500 }, { householdId: B, amount: 20000 }], o, 'KEIKO')).rejects.toThrow('bad_alloc');
    expect((await assignBankRow(row53000, [{ householdId: A, amount: 26500 }, { householdId: B, amount: 26500 }], o, 'KEIKO')).paymentIds).toHaveLength(2);
  });
  it('36 分けた片方を取り消す：行は matched のまま、のこり 26,500 の行として出る。全額では当てられない', async () => {
    // A・B・C＝合計 26,500 ずつ。53,000 の行を A と B に分けたあと、B の分を取り消して C へ
    const { ev, ids: [A, B, C] } = await fresh('36', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }, { ref: '4867', kana: 'スズキ', charges: [26500] }, { ref: '4872', kana: 'タナカ', charges: [26500] }]);
    const row53000 = await insertLedgerRow(ev, { amount: 53000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds: [, payB] } = await assignBankRow(row53000, [{ householdId: A, amount: 26500 }, { householdId: B, amount: 26500 }], o, 'KEIKO');
    await cancelBankPayment(payB, 'wrong_household', 'KEIKO');
    const v = (await listReviewRows(ev)).find((x) => x.rowId === row53000);
    expect(v).toMatchObject({ state: 'matched', isLeftover: true, leftover: 26500 });
    await expect(assignBankRow(row53000, [{ householdId: C, amount: 53000 }], o, 'KEIKO')).rejects.toThrow('bad_alloc');
    await assignBankRow(row53000, [{ householdId: C, amount: 26500 }], o, 'KEIKO');
  });
  it('29 取り消し：マイナスの行・台帳の行は new・残りがもどる・自動のメールは出ない／そのあと別の世帯に当て直せる', async () => {
    // A・C＝合計 26,500。26,500 の行を A に当ててから取り消し、C に当て直す
    const { ev, ids: [A, C] } = await fresh('29', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }, { ref: '4872', kana: 'タナカ', charges: [26500] }]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds: [payA] } = await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    const before = await mailCount(A);
    expect(await cancelBankPayment(payA, 'wrong_household', 'KEIKO')).toEqual({ ok: true });
    expect(await getOne(`SELECT amount FROM recital_payments WHERE household_id=? ORDER BY id DESC LIMIT 1`, [A])).toMatchObject({ amount: -26500 });
    expect(await rowState(row)).toBe('new');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(26500);
    expect(await mailCount(A)).toBe(before);
    await assignBankRow(row, [{ householdId: C, amount: 26500 }], o, 'KEIKO');
    expect((await readHouseholdMoney(C)).m.remaining).toBe(0);
  });
  it('37 取り消した入金に返す分（todo）→ cancelled／もう返した（done）→ refund_done で何も変えない', async () => {
    // A・D＝合計 26,500。32,500 の行をそれぞれに当てる → 返す分 6,000（todo・source_payment_id＝その入金）
    const { ev, ids: [A, D] } = await fresh('37', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }, { ref: '4727', kana: 'サトウ', charges: [26500] }]);
    const row32500 = await insertLedgerRow(ev, { amount: 32500, balance: 150000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const row32500b = await insertLedgerRow(ev, { amount: 32500, balance: 182500, desc_raw: '振込 4727 サトウ ジロウ' });
    const { paymentIds: [p1] } = await assignBankRow(row32500, [{ householdId: A, amount: 32500 }], o, 'KEIKO');
    await cancelBankPayment(p1, 'wrong_household', 'KEIKO');
    expect(await getOne(`SELECT amount, status FROM recital_refunds WHERE source_payment_id=?`, [p1])).toEqual({ amount: 6000, status: 'cancelled' });
    // D に 32,500 の行を当て、返す分を done にしてから取り消す
    const { paymentIds: [p2] } = await assignBankRow(row32500b, [{ householdId: D, amount: 32500 }], o, 'KEIKO');
    await execute(`UPDATE recital_refunds SET status='done' WHERE source_payment_id=?`, [p2]);
    const n = (await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id=?`, [D]))?.n;
    expect(await cancelBankPayment(p2, 'wrong_household', 'KEIKO')).toEqual({ ok: false, code: 'refund_done' });
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id=?`, [D]))?.n).toBe(n);
  });
  it('払った額が 0 未満になる取り消し → negative', async () => {
    // E＝合計 26,500。26,500 の行を当てたあと、手で −26,500 の調整（打ちまちがいの打ち消し）が入っている
    const { ev, ids: [E] } = await fresh('neg', [{ ref: '9827', kana: 'ヤマダ', charges: [26500] }]);
    const rowE = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 9827 ヤマダ ハナコ' });
    const { paymentIds: [p] } = await assignBankRow(rowE, [{ householdId: E, amount: 26500 }], o, 'KEIKO');
    await recordManualPayment(E, { method: 'adjust', amount: -26500, paidOn: '2026-12-16', memo: '打ちまちがい' }, 'KEIKO');
    expect(await cancelBankPayment(p, 'wrong_household', 'KEIKO')).toEqual({ ok: false, code: 'negative' });
    expect(await rowState(rowE)).toBe('matched');
  });
  it('misread で取り消して、同じ世帯に同じ額で当て直す → メールの記録がふえない', async () => {
    // A＝合計 26,500。26,500 の行を当てる（完了のメール1通）→ misread で取り消し → 同じ額で当て直す
    const { ev, ids: [A] } = await fresh('mis', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds: [payA] } = await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    const n = await mailCount(A);
    await cancelBankPayment(payA, 'misread', 'KEIKO');
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(await mailCount(A)).toBe(n);
  });
  it('取り消すと「振り込みました」の印がもどる（at・date・amount・by が同じ。名義は空）', async () => {
    // F＝合計 26,500・印 26,500（家庭が押した）。26,500 の行
    const { ev, ids: [F] } = await fresh('told', [{ ref: '1234', kana: 'ヤマダ', charges: [26500] }]);
    const rowF = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 1234 ヤマダ ハナコ' });
    const at0 = '2026-12-15T01:00:00.000Z';
    await execute(`UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-15', bank_told_name='1234 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [at0, F]);
    const { paymentIds: [p] } = await assignBankRow(rowF, [{ householdId: F, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT bank_told_at FROM recital_households WHERE id=?`, [F]))?.bank_told_at).toBeNull();
    await cancelBankPayment(p, 'wrong_household', 'KEIKO');
    expect(await getOne(`SELECT bank_told_at, bank_told_date, bank_told_amount, bank_told_by, bank_told_name FROM recital_households WHERE id=?`, [F]))
      .toEqual({ bank_told_at: at0, bank_told_date: '2026-12-15', bank_told_amount: 26500, bank_told_by: 'family', bank_told_name: null });
  });
  it('夜に当てて待ちになったメールは、取り消すと cancelled', async () => {
    // G＝合計 26,500。22:00 に 26,500 の行を当てる → 完了のメールは待ち
    const { ev, ids: [G] } = await fresh('night', [{ ref: '9054', kana: 'ヤマダ', charges: [26500] }]);
    const rowG = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 9054 ヤマダ ハナコ' });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-16T22:00:00+09:00'));
    const { paymentIds: [p] } = await assignBankRow(rowG, [{ householdId: G, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE dedupe_key=?`, [`bank_paid:${p}`]))?.status).toBe('waiting');
    await cancelBankPayment(p, 'wrong_household', 'KEIKO');
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE dedupe_key=?`, [`bank_paid:${p}`]))?.status).toBe('cancelled');
    vi.useRealTimers();
  });
  it('印のある行は confirmFlag なしでは当てない', async () => {
    // A＝合計 26,500。印 last の付いた 26,500 の行
    const { ev, ids: [A] } = await fresh('flag', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }]);
    const lastRow = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ', check_flag: 'last' });
    await expect(assignBankRow(lastRow, [{ householdId: A, amount: 26500 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO')).rejects.toThrow('confirm_flag');
  });
  it('first5 の行を番号の世帯に当てる → source は bank_auto（はじめの5件に数える）', async () => {
    const ev = 't-bank-b5'; await seedEvent(ev); const H5 = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', new Date('2026-12-16T12:00:00+09:00'));   // first_ok なし → first5
    const row = (await getOne(`SELECT id FROM recital_bank_rows WHERE event_key=? AND review_kind='first5'`, [ev]))!.id;
    await assignBankRow(Number(row), [{ householdId: H5, amount: 26500 }], o, 'KEIKO');
    expect(await getOne(`SELECT source, confirmed_by FROM recital_payments WHERE household_id=?`, [H5])).toEqual({ source: 'bank_auto', confirmed_by: 'KEIKO' });
  });
  it('発表会ではない：名義が消える／もとにもどす：理由が要る、名義は空のまま', async () => {
    // 世帯なし。名義つきの 26,500 の行1つ
    const { ev } = await fresh('nr', []);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await setBankRowState([row], 'not_recital', null, 'KEIKO');
    expect(await getOne(`SELECT desc_raw, desc_norm, state FROM recital_bank_rows WHERE id=?`, [row])).toMatchObject({ desc_raw: null, desc_norm: null, state: 'not_recital' });
    await expect(restoreBankRow(row, '', 'KEIKO')).rejects.toThrow('reason_required');
    await restoreBankRow(row, '押しまちがい', 'KEIKO');
    expect(await getOne(`SELECT desc_raw, state FROM recital_bank_rows WHERE id=?`, [row])).toMatchObject({ desc_raw: null, state: 'new' });
  });
  it('当てた入金がある行は 読みまちがい・発表会ではない にできない', async () => {
    // A＝合計 26,500。26,500 の行を当ててから void／not_recital にしようとする
    const { ev, ids: [A] } = await fresh('hp', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }]);
    const matchedRow = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await assignBankRow(matchedRow, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    await expect(setBankRowState([matchedRow], 'void', null, 'KEIKO')).rejects.toThrow('has_payment');
    await expect(setBankRowState([matchedRow], 'not_recital', null, 'KEIKO')).rejects.toThrow('has_payment');
  });
  it('35 同じ入金にする：manual の行は void、当てた入金は新しい行へ付けかわる、メールは出ない', async () => {
    const ev = 't-bank-b35'; await seedEvent(ev); const H = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const man = await insertLedgerRow(ev, { source: 'manual', amount: 26500, row_date: '2026-12-16', balance: null, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds: [p] } = await assignBankRow(man, [{ householdId: H, amount: 26500 }], o, 'KEIKO');
    const n = await mailCount(H);
    const neu = await insertLedgerRow(ev, { source: 'chat', amount: 26500, row_date: '2026-12-16', desc_raw: '振込 4823 ヤマダ ハナコ', check_flag: 'manual_twin' });
    await mergeManualRow(man, neu, 'KEIKO');
    expect(await rowState(man)).toBe('void');
    expect(await getOne(`SELECT state, check_flag FROM recital_bank_rows WHERE id=?`, [neu])).toEqual({ state: 'matched', check_flag: null });
    expect(Number((await getOne(`SELECT bank_transaction_id t FROM recital_payments WHERE id=?`, [p]))?.t)).toBe(neu);
    expect(await mailCount(H)).toBe(n);
  });
  it('listReviewRows：残高を返さない・保留の行も出る・候補0は no_candidate・外した行は closed', async () => {
    // A＝合計 26,500。行：番号つき 26,500（review）／保留にした 5,000（候補0）／発表会ではないにした 7,000（closed）
    const { ev } = await fresh('list', [{ ref: '4823', kana: 'ヤマダ', charges: [26500] }]);
    const r1 = await insertLedgerRow(ev, { amount: 26500, balance: 150000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const r2 = await insertLedgerRow(ev, { amount: 5000, balance: 155000, desc_raw: '振込 ﾀﾅｶ ｲﾁﾛｳ' });
    const r3 = await insertLedgerRow(ev, { amount: 7000, balance: 162000, desc_raw: '振込 ｻﾄｳ ｼﾞﾛｳ' });
    await setBankRowState([r2], 'hold', '確かめ中', 'KEIKO');
    await setBankRowState([r3], 'not_recital', null, 'KEIKO');
    const rows = await listReviewRows(ev);
    expect(rows.every((x) => !('balance' in x))).toBe(true);
    expect(rows.find((x) => x.rowId === r1)?.group).toBe('review');
    expect(rows.find((x) => x.rowId === r2)).toMatchObject({ group: 'no_candidate', state: 'hold' });
    expect(rows.find((x) => x.rowId === r3)?.group).toBe('closed');
  });
  it('listReviewRows は開くたびに種類を計算し直して書く（世帯が作品を足して残りが 32,500 になると、26,500 の行は over から short に変わる）', async () => {
    const ev = 't-bank-b20'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [20000] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await listReviewRows(ev);
    expect((await getOne(`SELECT review_kind k FROM recital_bank_rows WHERE id=?`, [row]))?.k).toBe('over');
    await addCharge(A, 12500);                      // 合計 32,500 にする（試験の中の小さな関数。base の行を1つ足す）
    await listReviewRows(ev);
    expect((await getOne(`SELECT review_kind k FROM recital_bank_rows WHERE id=?`, [row]))?.k).toBe('short');
  });
  // ── 場面の表（5-6）で、ほかの試験に無かった物
  it('6 振込手数料ぶん少ない：short を「送らない」で当て → 差を手で調整 → 残り0 → メールはこの1通だけ（complete）', async () => {
    const ev = 't-bank-b6'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26060, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: A, amount: 26060 }], { sendRemaining: false, confirmFlag: false }, 'KEIKO');
    expect(await mailKinds(A)).toEqual([]);
    const { paymentId } = await recordManualPayment(A, { method: 'adjust', amount: 440, paidOn: '2026-12-16', memo: '振込手数料ぶん' }, 'KEIKO');
    await sendPaidMail(A, paymentId, 'adjust');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(0);
    expect(await mailKinds(A)).toEqual(['complete']);
  });
  it('8 払い済みの世帯に 26,500 → 当てると全額が返す分1番・確認のメールは出ない', async () => {
    const ev = 't-bank-b8'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await recordManualPayment(A, { method: 'cash', amount: 26500, paidOn: '2026-12-15', memo: '' }, 'KEIKO');
    const before = await mailCount(A);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(await getOne(`SELECT amount, reason_no FROM recital_refunds WHERE household_id=? AND status='todo'`, [A])).toMatchObject({ amount: 26500, reason_no: 1 });
    expect(await bankPaidMailKeys(A)).toEqual([]);
    expect(await mailCount(A)).toBe(before);
  });
  it('10・44 出演なしの世帯に当てても、返す分は自動で作らず、メールも0通', async () => {
    const ev = 't-bank-b10'; await seedEvent(ev); const N = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [], cast: 'out' });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await assignBankRow(row, [{ householdId: N, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id=?`, [N]))?.n).toBe(0);
    expect(await mailCount(N)).toBe(0);
  });
  it('11 まとめた世帯の番号で来た入金 → まとめ先を選んで当てて残り0', async () => {
    const ev = 't-bank-b11'; await seedEvent(ev);
    const into = await seedHousehold(ev, { ref: '1007', lastKana: 'ヤマダ', charges: [26500] });
    const from = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [] });
    await execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [into, from]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await expect(assignBankRow(row, [{ householdId: from, amount: 26500 }], o, 'KEIKO')).rejects.toThrow('merged');
    await assignBankRow(row, [{ householdId: into, amount: 26500 }], o, 'KEIKO');
    expect((await readHouseholdMoney(into)).m.remaining).toBe(0);
  });
  it('28「振り込みました」26,500 のあと作品を足して合計 32,500 → 26,500 の行は short、当てたあと残り 6,000', async () => {
    const ev = 't-bank-b28'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [32500] });
    await execute(`UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-15', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [new Date().toISOString(), A]);
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    expect((await listReviewRows(ev)).find((x) => x.rowId === row)?.reviewKind).toBe('short');
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(6000);
  });
  // ── 2人が同時に押す（Review Focus）
  it('同じ行を A と B に全額ずつ同時に当てる → 1つだけ通り、もう片方は row_over か bad_state か busy で、入金は1行', async () => {
    const ev = 't-bank-bc1'; await seedEvent(ev);
    const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] }); const B = await seedHousehold(ev, { ref: '4867', lastKana: 'スズキ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 ヤマダ ハナコ' });
    const rs = await Promise.allSettled([assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'TARO'), assignBankRow(row, [{ householdId: B, amount: 26500 }], o, 'KEIKO')]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const err = rs.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(['row_over', 'bad_state', 'recital_money:row_over', 'busy']).toContain(String(err.reason.message));   // libsql は同じプロセスから2本同時に書くと2本目が SQLITE_BUSY ですぐ落ちる＝busy に直して返す
    expect((await getOne(`SELECT COUNT(*) n FROM recital_payments WHERE bank_transaction_id=?`, [row]))?.n).toBe(1);
  });
  it('同じ行を同じ世帯に2回 → 2回目は live_exists か bad_state か busy、メールは1通', async () => {
    const ev = 't-bank-bc2'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const rs = await Promise.allSettled([assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'TARO'), assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO')]);
    expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await bankPaidMailKeys(A)).toHaveLength(1);
  });
});

describe('見てほしい入金のボタン：前のタスクから持ち越した約束', () => {
  const NOON = new Date('2026-12-16T12:00:00+09:00');
  afterEach(() => { vi.restoreAllMocks(); txFault.next = null; });

  it('(a) 取り消して new にもどした行は、次の「はい」の束でも自動で当たらない（K147）', async () => {
    const ev = 't-bank-ka1'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    const pay = await getOne(`SELECT id, bank_transaction_id FROM recital_payments WHERE household_id=?`, [A]);
    await cancelBankPayment(Number(pay?.id), 'wrong_household', 'KEIKO');
    expect(await rowState(Number(pay?.bank_transaction_id))).toBe('new');
    const again = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(again.auto_matched).toBe(0);
    expect((await readHouseholdMoney(A)).m.remaining).toBe(26500);
    // 開いても first5 にならない（人が決めた行は、自動の種類にしない）
    expect((await listReviewRows(ev)).find((x) => x.rowId === Number(pay?.bank_transaction_id))?.reviewKind).toBe('manual');
  });
  it('(a) 保留から「もとにもどす」した first5 の行は、次の「はい」の束でも自動で当たらない', async () => {
    const ev = 't-bank-ka2'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', NOON);                       // first5 で待つ
    const row = Number((await getOne(`SELECT id FROM recital_bank_rows WHERE event_key=? AND review_kind='first5'`, [ev]))?.id);
    await setBankRowState([row], 'hold', null, 'KEIKO');
    await restoreBankRow(row, '押しまちがい', 'KEIKO');
    expect(await getOne(`SELECT state, review_kind FROM recital_bank_rows WHERE id=?`, [row])).toEqual({ state: 'new', review_kind: 'manual' });
    const dry = await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'dry', 'test', NOON);
    expect(dry.first5_rows?.some((x) => x.pos.startsWith('ledger-'))).toBe(false);
    const res = await ingestBankBatch({ ...b(SAMPLE, { event_key: ev }), first_ok: true }, 'commit', 'test', NOON);
    expect(res.auto_matched).toBe(0);
    expect((await readHouseholdMoney(A)).m.remaining).toBe(26500);
  });
  it('(b) 何度渡しても当てられない行は、2回目で見てほしい入金へ回し、3回目の束は match_failed にしない', async () => {
    const ev = 't-bank-kb'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const stop = vi.spyOn(bankDb.__internal, 'matchOneRow').mockRejectedValue(new Error('recital_test:stop'));
    const bb = { ...b(SAMPLE, { event_key: ev }), first_ok: true };
    await expect(ingestBankBatch(bb, 'commit', 'test', NOON)).rejects.toThrow('recital_bank:match_failed');
    expect(await getOne(`SELECT review_kind, decided_by FROM recital_bank_rows WHERE event_key=? AND ref_read='4823'`, [ev])).toEqual({ review_kind: null, decided_by: null });
    await expect(ingestBankBatch(bb, 'commit', 'test', NOON)).rejects.toThrow('recital_bank:match_failed');
    expect(await getOne(`SELECT state, review_kind, decided_by FROM recital_bank_rows WHERE event_key=? AND ref_read='4823'`, [ev])).toEqual({ state: 'new', review_kind: 'manual', decided_by: 'system' });
    stop.mockRestore();
    await expect(ingestBankBatch(bb, 'commit', 'test', NOON)).resolves.toMatchObject({ auto_matched: 0 });
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/ヤマダ/);
    expect((await listReviewRows(ev)).some((x) => x.group === 'review' && x.refRead === '4823')).toBe(true);
  });
  it('(d) void・出金の台帳の行には、核（insertPaymentTx）でも入金を作らない', async () => {
    const ev = 't-bank-kd'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const voidRow = await insertLedgerRow(ev, { amount: 26500, state: 'void' });
    const outRow = await insertLedgerRow(ev, { amount: 26500, dir: 'out', kind: 'debit', balance: 1000 });
    const { withWriteTx } = await import('../db');
    const { insertPaymentTx } = await import('../recitalMoneyDb');
    for (const r of [voidRow, outRow]) {
      await expect(withWriteTx((tx) => insertPaymentTx(tx, { householdId: A, method: 'bank', amount: 26500, paidOn: '2026-12-16', source: 'bank_staff', bankRowId: r }, 'KEIKO')))
        .rejects.toThrow('recital_money:bad_input');
      await expect(assignBankRow(r, [{ householdId: A, amount: 26500 }], o, 'KEIKO')).rejects.toThrow('bad_state');
    }
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [A])).toBe(0);
  });
  it('(e) まとめた世帯の振込の入金は取り消せない（merged）・同じ入金を2回は取り消せない（already_cancelled）', async () => {
    const ev = 't-bank-ke'; await seedEvent(ev);
    const into = await seedHousehold(ev, { ref: '4867', lastKana: 'ヤマダ', charges: [26500] });
    const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const { paymentIds: [p] } = await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    await execute(`UPDATE recital_households SET status='merged', merged_into=? WHERE id=?`, [into, A]);
    await expect(cancelBankPayment(p, 'wrong_household', 'KEIKO')).rejects.toThrow('merged');
    await execute(`UPDATE recital_households SET status='active', merged_into=NULL WHERE id=?`, [A]);
    await cancelBankPayment(p, 'misread', 'KEIKO');
    await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');      // 同じ行を同じ世帯に当て直す（行と世帯の合計は 26,500 にもどる）
    await expect(cancelBankPayment(p, 'misread', 'KEIKO')).rejects.toThrow('already_cancelled');
  });
  it('書き込みが SQLITE_BUSY で落ちたら busy（当てる・取り消す）。何も書かない', async () => {
    const ev = 't-bank-busy'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    txFault.next = Object.assign(new Error('SQLITE_BUSY: database is locked'), { code: 'SQLITE_BUSY' });
    await expect(assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO')).rejects.toThrow('busy');
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [A])).toBe(0);
    const { paymentIds: [p] } = await assignBankRow(row, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    txFault.next = Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
    await expect(cancelBankPayment(p, 'wrong_household', 'KEIKO')).rejects.toThrow('busy');
    expect(await count('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [A])).toBe(1);
  });
});

describe('見てほしい入金のボタン：見直し1回目', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); txFault.next = null; txFault.batch = null; });

  it('書き込みを1本ずつ通すのは手元のファイルの DB の時だけ（本番の Turso ではそのまま書く）', () => {
    const { serialFor } = bankDb.__internal;
    expect(serialFor(undefined)).toBe(true);
    expect(serialFor('')).toBe(true);
    expect(serialFor('file:./data/test.db')).toBe(true);
    expect(serialFor('libsql://example-db.turso.io')).toBe(false);
    expect(serialFor('https://example-db.turso.io')).toBe(false);
  });
  it('種類の書きもどしが落ちても、一覧は出る（ログに名義を出さない）', async () => {
    const ev = 't-bank-r2a'; await seedEvent(ev); await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    const row = await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    txFault.batch = new Error('recital_test:batch');
    const rows = await listReviewRows(ev);
    expect(rows.find((x) => x.rowId === row)).toMatchObject({ group: 'review', reviewKind: 'first5' });
    expect(err).toHaveBeenCalled();
    expect(err.mock.calls.flat().join(' ')).not.toMatch(/ヤマダ|4823/);
    expect((await getOne(`SELECT review_kind k FROM recital_bank_rows WHERE id=?`, [row]))?.k).toBeNull();
  });
  it('足すとぴったりで2行に当てた古い方を取り消すと、新しい方の鍵で待っていたメールも取りやめ', async () => {
    const ev = 't-bank-r2c'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [32500] });
    const row26500 = await insertLedgerRow(ev, { amount: 26500, balance: 150000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await insertLedgerRow(ev, { amount: 6000, balance: 156000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-12-16T22:00:00+09:00'));
    const { paymentIds: [p1, p2] } = await assignBankRow(row26500, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE dedupe_key=?`, [`bank_paid:${p2}`]))?.status).toBe('waiting');
    await cancelBankPayment(p1, 'wrong_household', 'KEIKO');
    expect((await getOne(`SELECT status FROM recital_mail_log WHERE dedupe_key=?`, [`bank_paid:${p2}`]))?.status).toBe('cancelled');
  });
  it('足すとぴったりの組に、保留にした行は入れない（その行は保留のまま）', async () => {
    const ev = 't-bank-r2d'; await seedEvent(ev); const A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [32500] });
    const row26500 = await insertLedgerRow(ev, { amount: 26500, balance: 150000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    const row6000 = await insertLedgerRow(ev, { amount: 6000, balance: 156000, desc_raw: '振込 4823 ヤマダ ハナコ' });
    await setBankRowState([row6000], 'hold', '確かめ中', 'KEIKO');
    const { paymentIds } = await assignBankRow(row26500, [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(paymentIds).toHaveLength(1);
    expect(await rowState(row6000)).toBe('hold');
    expect((await readHouseholdMoney(A)).m.remaining).toBe(6000);
  });
  it('同じ入金にする：新しい行が入金の振込でなければ bad_state', async () => {
    const ev = 't-bank-r2e'; await seedEvent(ev);
    const man = await insertLedgerRow(ev, { source: 'manual', kind: 'other', amount: 300, balance: null });
    const neu = await insertLedgerRow(ev, { source: 'chat', kind: 'other', amount: 300, balance: 150300 });
    await expect(mergeManualRow(man, neu, 'KEIKO')).rejects.toThrow('bad_state');
    expect(await rowState(man)).toBe('new');
  });
});

// Task 24：夜の声かけと朝の入口が使う事実（開始日・前に撮った日・見てほしい入金の数・今日の合った束）。
// 4つの試験は同じ t-ask を順に育てる（上から順に走る）。
describe('getBankAskFacts', () => {
  const ev = 't-ask';
  /** 束の記録を直に1行（imported_at は UTC ISO・Z 付き＝nowUtcIso の形） */
  const addImport = (o: { importedAt: string; source: string; check: string; shotOn: string | null }) =>
    execute(
      `INSERT INTO recital_imports (event_key, created_at, kind, imported_by, imported_at, shot_on, source, check_result) VALUES (?, ?, 'statement', 'test', ?, ?, ?, ?)`,
      [ev, o.importedAt, o.importedAt, o.shotOn, o.source, o.check],
    );

  it('台帳が空なら開始日は「払う」を開けた日の前の日（12/15 に開ければ 12/14）', async () => {
    await seedEvent(ev);   // pay_open_at='2026-12-15 12:00'
    await execute(`INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, 'pay_ok_at', '2026-12-14 10:00', ?) ON CONFLICT(event_key,key) DO UPDATE SET value=excluded.value`, [ev, new Date().toISOString()]);
    const f = await getBankAskFacts(ev, new Date('2026-12-15T10:00:00Z'));
    expect(f).toEqual({ startDate: '2026-12-14', lastShotOn: null, reviewCount: 0, okBatchToday: false });
  });
  it('開始日は台帳のいちばん新しい振込の入金の行の日（manual は数えない）', async () => {
    await insertLedgerRow(ev, { row_date: '2026-12-18', source: 'chat', balance: 150000 });
    await insertLedgerRow(ev, { row_date: '2026-12-19', source: 'manual', balance: null });
    expect((await getBankAskFacts(ev, new Date('2026-12-20T10:00:00Z'))).startDate).toBe('2026-12-18');
  });
  it('今日の合った束：chat/file の ok だけ・manual と ng は数えない・前に撮った日はいちばん新しい ok の shot_on', async () => {
    await addImport({ importedAt: '2026-12-20T09:00:00.000Z', source: 'manual', check: 'ok', shotOn: '2026-12-20' });          // 12/20 18:00 JST の manual ok
    await addImport({ importedAt: '2026-12-20T09:30:00.000Z', source: 'chat', check: 'ng:12/20:26500', shotOn: '2026-12-20' }); // 12/20 18:30 JST の chat ng
    await addImport({ importedAt: '2026-12-19T14:59:00.000Z', source: 'chat', check: 'ok', shotOn: '2026-12-19' });             // 12/19 23:59 JST の chat ok（前の日）
    const f = await getBankAskFacts(ev, new Date('2026-12-20T11:00:00Z'));
    expect(f.okBatchToday).toBe(false);
    expect(f.lastShotOn).toBe('2026-12-19');
    await addImport({ importedAt: '2026-12-20T10:10:00.000Z', source: 'file', check: 'ok', shotOn: '2026-12-20' });             // 12/20 19:10 JST の file ok
    const g = await getBankAskFacts(ev, new Date('2026-12-20T11:00:00Z'));
    expect(g.okBatchToday).toBe(true);
    expect(g.lastShotOn).toBe('2026-12-20');
    // 次の日（JST）になれば、前の日の束は今日の束ではない
    expect((await getBankAskFacts(ev, new Date('2026-12-20T15:00:00Z'))).okBatchToday).toBe(false);
  });
  it('見てほしい入金の数は listReviewRows の数', async () => {
    const before = (await getBankAskFacts(ev, new Date('2026-12-20T10:00:00Z'))).reviewCount;
    await insertLedgerRow(ev, { row_date: '2026-12-20', source: 'chat', amount: 26500, balance: 176500, desc_raw: '振込 ヤマダ ハナコ' });
    const voided = await insertLedgerRow(ev, { row_date: '2026-12-20', source: 'chat', amount: 1000, balance: 177500, desc_raw: '振込 タナカ' });
    await setBankRowState([voided], 'not_recital', null, 'test');   // closed の行は数えない
    const f = await getBankAskFacts(ev, new Date('2026-12-20T10:00:00Z'));
    expect(f.reviewCount).toBe(before + 1);
    expect(f.reviewCount).toBe((await listReviewRows(ev)).filter((x) => x.group !== 'closed').length);
    expect((await listReviewRows(ev)).some((x) => x.group === 'closed')).toBe(true);
  });
});

// ---------- Task 29：見てほしい入金と、入金の取り込みの画面が読む2つ ----------
const { listToldWaiting, listImports } = bankDb;

describe('listToldWaiting（「振り込みました」のまま3日）', () => {
  // 自分の発表会を2つ作る（27・28 の世帯は使わない）。休みの設定は 27 の seedEvent のまま（bank_rest_from 12/30・bank_rest_to 1/3）
  const ev = 't-bank-told1', ev2 = 't-bank-told2'; let A = 0;
  beforeAll(async () => {
    await seedEvent(ev); A = await seedHousehold(ev, { ref: '4823', lastKana: 'ヤマダ', charges: [26500] });
    await execute(`UPDATE recital_households SET bank_told_at='2027-02-05T03:00:00.000Z', bank_told_date='2027-02-05', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [A]);
    await seedEvent(ev2); const B = await seedHousehold(ev2, { ref: '4867', lastKana: 'スズキ', charges: [26500] });
    await execute(`UPDATE recital_households SET bank_told_at='2026-12-29T03:00:00.000Z', bank_told_date='2026-12-29', bank_told_amount=26500, bank_told_by='family' WHERE id=?`, [B]);
  });
  it('2/5 に押した → 2/7 の朝は出ない、2/8 の朝に出る', async () => {
    // bank_told_at = 2027-02-05T03:00:00Z（JST 2/5 昼）、残り 26,500
    expect(await listToldWaiting(ev, new Date('2027-02-07T08:00:00+09:00'))).toHaveLength(0);
    expect((await listToldWaiting(ev, new Date('2027-02-08T08:00:00+09:00'))).map((h) => h.id)).toEqual([A]);
  });
  it('12/30〜1/3 は数えない（12/29 に押した → 1/6 に出る）', async () => {
    expect(await listToldWaiting(ev2, new Date('2027-01-05T08:00:00+09:00'))).toHaveLength(0);
    expect(await listToldWaiting(ev2, new Date('2027-01-06T08:00:00+09:00'))).toHaveLength(1);
  });
  it('残りが 0 の世帯・印が閉じた世帯は出ない', async () => {
    // ev の世帯 A に 26,500 の行を当てる（9 が印を閉じ、残りも 0）
    await assignBankRow(await insertLedgerRow(ev, { amount: 26500, desc_raw: '振込 4823 ヤマダ ハナコ' }), [{ householdId: A, amount: 26500 }], o, 'KEIKO');
    expect(await listToldWaiting(ev, new Date('2027-02-08T08:00:00+09:00'))).toHaveLength(0);
  });
});
describe('listImports', () => {
  it('新しい順。dry の合わなかった行もふくむ', async () => {
    const ev = 't-bank-imp'; await seedEvent(ev);
    await ingestBankBatch(b(SAMPLE, { event_key: ev }), 'commit', 'test', new Date('2026-12-16T12:00:00+09:00'));
    const bad = SAMPLE.map((x) => (x.pos === '1-1' ? { ...x, balance: 153001 } : x));
    await ingestBankBatch(b(bad, { event_key: ev }), 'dry', 'test', new Date('2026-12-17T12:00:00+09:00'));
    expect((await listImports(ev)).map((x) => x.check_result)).toEqual(['ng:12/16:26500', 'ok']);
  });
});
