// BW6 発表会（段階1）の recitalPayDb.ts（開いている支払い recital_checkouts の作る・聞いて合わせる・切る）の試験（実 DB・試験用のファイル DB）。
// このファイルは 21・22・23 が足していく。タスクごとに describe を分け、各 describe の頭（beforeAll）で自分の世帯を作る。
// ほかのタスクの describe の世帯を使わない。自分の event_key（t-pay*）の行だけを見る。
// 本物の Stripe は呼ばない（fetch は vi.stubGlobal で差しかえる）。メールは 10 の送る所を mock する。
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { setupRecitalTestDb } from './recitalTestSeed';

// 22 は本物の sendPaidMail（メールの鍵が無い試験環境＝送れずに記録だけ残る）を通すので、切りかえの印を持つ
const mailMode = vi.hoisted(() => ({ real: false }));
// 2つの書き方は同じファイルを指し、あとの vi.mock が勝つので、両方を同じ中身にする
const mailMock = async (importActual: <T>() => Promise<T>) => {
  const actual = await importActual<typeof import('../recitalMail')>();
  return {
    sendRecitalMail: vi.fn(async () => ({ status: 'sent', logId: 1 })),
    sendPaidMail: vi.fn(async (...a: Parameters<typeof actual.sendPaidMail>) => (mailMode.real ? actual.sendPaidMail(...a) : { status: 'none' })),
  };
};
vi.mock('@/lib/recitalMail', (importActual) => mailMock(importActual));
vi.mock('@/lib/recitalMail.ts', (importActual) => mailMock(importActual));
// 22 の「記録に失敗した」知らせ（本物の Pushover・LINE・メールは呼ばない）
vi.mock('@/lib/notify', () => ({ notifyTaro: vi.fn(async () => {}) }));

process.env.STRIPE_TEST_SECRET_KEY = 'sk_test_dummy';

await setupRecitalTestDb('pay');
const core = await import('../db');
const { execute, getOne, withWriteTx } = core;
const { nowUtcIso } = await import('../dateJst');
const entry = await import('../recitalEntryDb');
const money = await import('../recitalMoneyDb');
const { insertPaymentTx, recordManualPayment, afterMoneyChanged } = money;
const pay = await import('../recitalPayDb');
const { startCardPayment, syncCardCheckout, applyRecitalWebhookEvent, handleRecitalWebhook } = pay;
const { notifyTaro } = await import('../notify');
const { isMailConfigured } = await import('../email');

// 手元のファイル DB（libsql の file:）は、書き込みが同時に来ると接続が使えないまま残る（recitalEntryDb.test.ts の説明のとおり）。
// 本物の同時の試験は Turso の試しの DB に向けて回す（RECITAL_TEST_DB_URL）。
const LOCAL_FILE_DB = (process.env.TURSO_DATABASE_URL ?? '').startsWith('file:');

// ---------- 下ごしらえ ----------

const FEE_RULES: [string, string, number, number | null, number, number, string][] = [
  ['first', 'base', 1, 1, 16000, 1, '出演料（本体）'],
  ['first', 'tshirt', 1, 1, 3000, 1, 'Tシャツ'],
  ['first', 'coop_ticket', 1, 1, 2500, 3, '協力チケット3枚'],
  ['first', 'add_work', 2, 2, 6000, 1, '2作品目'],
  ['first', 'add_work', 3, null, 3000, 1, '3作品目から（1作品ごと）'],
  ['family', 'base', 1, 1, 5000, 1, 'ご家族の参加費'],
  ['family', 'tshirt', 1, 1, 3000, 1, 'Tシャツ'],
  ['family', 'add_work', 2, null, 3000, 1, '2作品目から（1作品ごと）'],
];

const workIdsOf: Record<string, number[]> = {};

async function seedPayEvent(eventKey: string, stripeMode: 'test' | 'live', opts: { payOk?: boolean } = {}): Promise<void> {
  const now = nowUtcIso();
  await execute(
    'INSERT INTO recital_events (event_key, title, show_date, rehearsal_date, venue, is_test, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    [eventKey, '試し', '2027-04-11', '2027-04-10', '試しの会場', now],
  );
  const settings: Record<string, string> = {
    entry_open_at: '2026-01-01 00:00', entry_close_at: '2099-01-31 23:59', change_close_at: '2099-01-31 23:59',
    pay_open_at: '2026-01-01 00:00', pay_due: '2099-02-10', suspended: '0', stripe_mode: stripeMode,
    bank_text: '（試しの振込先）', test_mail_to: 'test@example.invalid', consent_items: '同意の文（試し）',
  };
  if (opts.payOk !== false) settings.pay_ok_at = '2026-01-01 00:00';
  for (const [key, value] of Object.entries(settings)) {
    await execute('INSERT INTO recital_settings (event_key, key, value, created_at) VALUES (?, ?, ?, ?)', [eventKey, key, value, now]);
  }
  for (const [i, [role, item, from, to, unit, qty, label]] of FEE_RULES.entries()) {
    await execute(
      `INSERT INTO recital_fee_rules (event_key, payer_role, item_code, nth_from, nth_to, unit_amount, qty, label, is_tentative, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [eventKey, role, item, from, to, unit, qty, label, i + 1, now],
    );
  }
  workIdsOf[eventKey] = [];
  for (const [i, code] of ['W01', 'W02'].entries()) {
    const r = await execute(
      `INSERT INTO recital_works (event_key, work_code, kind, title, entry_mode, fee_type, status, sort_order, created_at)
       VALUES (?, ?, 'class', ?, 'form', 'counted', 'open', ?, ?)`,
      [eventKey, code, `作品${i + 1}`, i + 1, now],
    );
    workIdsOf[eventKey].push(Number(r.lastInsertRowid));
  }
}

let seq = 0;
let firstChecked = false;
/** submitEntry で1世帯（1人・1作品・合計 26,500）を足す。呼ぶたびに submitKey・メール・電話を変える */
async function newHousehold(eventKey = 't-pay'): Promise<{ hid: number; token: string }> {
  seq++;
  const r = await entry.submitEntry({
    eventKey, submitKey: seq.toString(16).padStart(32, '0'),
    contact: { lastName: 'テスト', firstName: 'ハハ', lastKana: 'テスト', firstKana: 'ハハ', email: `pay${seq}@example.invalid`, phone: `0901234${String(seq).padStart(4, '0')}` },
    people: [{ tempId: 'p1', lastName: 'テスト', firstName: 'イチ', lastKana: 'テスト', firstKana: 'イチ', birthday: '2015-04-02', isContact: false, category: 'student', tshirtSize: null, instaHandle: null, works: [{ workId: workIdsOf[eventKey][0], status: 'in' }] }],
    confirmNotFamily: false, confirmSamePerson: true, consentAccepted: true,
  });
  if (!r.ok) throw new Error(`newHousehold: ${r.code}`);
  if (!firstChecked) {
    expect(r.total).toBe(26500);   // ちがえば規則の入れ方のまちがい
    firstChecked = true;
  }
  return { hid: r.householdId, token: r.token };
}

/** Stripe に作らせずに「開いている画面」を用意する */
async function seedOpenCheckout(hid: number, x: { sessionId: string; amount: number }): Promise<number> {
  const h = await core.getOne('SELECT event_key FROM recital_households WHERE id = ?', [hid]);
  const r = await execute(
    "INSERT INTO recital_checkouts (event_key, household_id, stripe_session_id, amount, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)",
    [String(h.event_key), hid, x.sessionId, x.amount, nowUtcIso()],
  );
  return Number(r.lastInsertRowid);
}

/** 2作品目を足す（applyHouseholdEdits。合計 32,500） */
async function addWork(hid: number): Promise<void> {
  const p = await core.getOne("SELECT id, event_key FROM recital_people WHERE household_id = ? AND status = 'active'", [hid]);
  const r = await entry.applyHouseholdEdits(hid, [{ type: 'cast_set', personId: Number(p.id), workId: workIdsOf[String(p.event_key)][1], status: 'in' }], { actor: '試し', by: 'staff', reason: '試し' });
  expect(r).toMatchObject({ ok: true, totalAfter: 32500 });
}

// ---------- Stripe の差しかえ ----------

const API = 'https://api.stripe.com/v1/checkout/sessions';
const stripe = { n: 0, created: [] as URLSearchParams[], expired: [] as string[], states: new Map<string, Record<string, unknown> | 'fail'>(), auth: new Map<string, string>() };

function jsonRes(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
  const method = init?.method ?? 'GET';
  if (method === 'POST' && url === API) {
    stripe.n++;
    stripe.created.push(new URLSearchParams(String(init?.body ?? '')));
    const id = `cs_test_${stripe.n}`;
    return jsonRes(200, { id, url: `https://checkout.stripe.com/c/pay/${id}` });
  }
  const id = decodeURIComponent(url.slice(API.length + 1).replace(/\/expire$/, ''));
  stripe.auth.set(`${method} ${id}`, String((init?.headers as Record<string, string> | undefined)?.Authorization ?? ''));
  if (method === 'POST' && url.endsWith('/expire')) {
    stripe.expired.push(id);
    return jsonRes(200, { id, status: 'expired' });
  }
  const st = stripe.states.get(id);
  if (st === 'fail') return jsonRes(500, { error: { code: 'api_error' } });
  return jsonRes(200, { id, status: 'open', payment_status: 'unpaid', url: `https://checkout.stripe.com/c/pay/${id}`, payment_intent: null, amount_total: null, ...(st ?? {}) });
}));

function resetStripe(): void {
  stripe.n = 0; stripe.created = []; stripe.expired = []; stripe.states.clear(); stripe.auth.clear();
}
const stripeState = (id: string, s: Record<string, unknown> | 'fail') => stripe.states.set(id, s);
const sentParams = (i: number) => stripe.created[i];
const lastParams = () => stripe.created[stripe.created.length - 1];
const createCalls = () => stripe.n;
const expireCalls = () => stripe.expired;

// ---------- 読む助け ----------

async function openRows(hid: number) {
  const rows = await core.getAll("SELECT amount, stripe_session_id, status FROM recital_checkouts WHERE household_id = ? AND status = 'open' ORDER BY id", [hid]);
  return rows.map((r) => ({ amount: Number(r.amount), stripe_session_id: r.stripe_session_id == null ? null : String(r.stripe_session_id), status: String(r.status) }));
}
async function row(hid: number) {
  return core.getOne('SELECT * FROM recital_households WHERE id = ?', [hid]);
}
async function payments(hid: number) {
  const rows = await core.getAll('SELECT method, amount, source, stripe_session_id, stripe_pi_id FROM recital_payments WHERE household_id = ? ORDER BY id', [hid]);
  return rows.map((r) => ({ method: String(r.method), amount: Number(r.amount), source: String(r.source), stripe_session_id: r.stripe_session_id, stripe_pi_id: r.stripe_pi_id }));
}
async function checkout(sessionId: string) {
  return core.getOne('SELECT * FROM recital_checkouts WHERE stripe_session_id = ?', [sessionId]);
}

await seedPayEvent('t-pay', 'test');
await seedPayEvent('t-pay-closed', 'test', { payOk: false });
await seedPayEvent('t-pay-live', 'live');

// =====================================================================
describe('Task 21 開いている支払い（作る・聞く・切る）', () => {
  let hid = 0;
  let token = '';
  beforeAll(async () => {
    ({ hid, token } = await newHousehold());
    resetStripe();
  });

  it('作る：金額は今の残り・開いている行1つ・pay_method=card', async () => {
    const r = await startCardPayment(token, {});
    expect(r).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(sentParams(0).get('line_items[0][price_data][unit_amount]')).toBe('26500');
    expect(sentParams(0).get('success_url')).toBe(`https://event.boom-sendai.com/bw6/my?t=${token}&paid=1`);
    expect(sentParams(0).get('cancel_url')).toBe(`https://event.boom-sendai.com/bw6/my?t=${token}`);
    expect(sentParams(0).get('metadata[recital_household_id]')).toBe(String(hid));
    expect(await openRows(hid)).toEqual([{ amount: 26500, stripe_session_id: 'cs_test_1', status: 'open' }]);
    expect((await row(hid)).pay_method).toBe('card');
  });
  it('同じ残りなら同じURL（作り直さない）', async () => {
    stripeState('cs_test_1', { status: 'open', url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(await startCardPayment(token, {})).toEqual({ url: 'https://checkout.stripe.com/c/pay/cs_test_1' });
    expect(createCalls()).toBe(1);
  });
  it('残りが変われば古い方を切って作り直す（afterMoneyChanged）', async () => {
    await recordManualPayment(hid, { method: 'cash', amount: 1000, paidOn: '2026-12-20', memo: '試し' }, '試し');
    await afterMoneyChanged(hid, 'payment');               // 9 が中で呼んでいても、2回目は何も起きない
    expect(expireCalls()).toContain('cs_test_1');
    expect(expireCalls().filter((x) => x === 'cs_test_1')).toHaveLength(1);
    expect(await openRows(hid)).toEqual([]);              // 切った行は closed
    expect((await checkout('cs_test_1')).status).toBe('closed');
    await startCardPayment(token, {});
    expect(sentParams(1).get('line_items[0][price_data][unit_amount]')).toBe('25500');
  });
  it('振込で全額当たり残り0になると、開いているカードの画面を切る', async () => {
    const { hid: h6, token: t6 } = await newHousehold();
    await startCardPayment(t6, {});
    const sid = (await openRows(h6))[0].stripe_session_id;
    await withWriteTx((tx) => insertPaymentTx(tx, { householdId: h6, method: 'bank', amount: 26500, paidOn: '2026-12-21', source: 'bank_staff' }, '試し'));
    await afterMoneyChanged(h6, 'payment');
    expect(await openRows(h6)).toEqual([]);
    expect(expireCalls()).toContain(sid);
  });
  it.skipIf(LOCAL_FILE_DB)('2つのタブで同時に押しても開いている行は1つ（Turso の試しの DB で回す）', async () => {
    const { hid: hid2, token: token2 } = await newHousehold();
    const rs = await Promise.allSettled([startCardPayment(token2, {}), startCardPayment(token2, {})]);
    expect(await openRows(hid2)).toHaveLength(1);
    expect(rs.filter((x) => x.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
  });
  it('振込を選んだ世帯は1回聞く', async () => {
    const { hid: hid3, token: token3 } = await newHousehold();
    await execute("UPDATE recital_households SET pay_method='bank' WHERE id=?", [hid3]);
    expect(await startCardPayment(token3, {})).toEqual({ blocked: 'ask_bank' });
    expect(await startCardPayment(token3, { confirmNotBank: true })).toHaveProperty('url');
  });
  it('「振り込みました」の印がある間は止める・残りが印より多ければ差額だけ（K204：32,500−26,500＝6,000）', async () => {
    const { hid: hid4, token: token4 } = await newHousehold();
    await execute("UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-20', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [nowUtcIso(), hid4]);
    expect(await startCardPayment(token4, { confirmNotBank: true })).toEqual({ blocked: 'told_open' });
    await addWork(hid4);                                   // applyHouseholdEdits で2作品目 → 32,500
    await startCardPayment(token4, { confirmTold: true });
    expect(lastParams().get('line_items[0][price_data][unit_amount]')).toBe('6000');
  });
  it('印の額が残り以上なら金額は変えない（26,500）', async () => {
    const { hid: h, token: t } = await newHousehold();
    await execute("UPDATE recital_households SET bank_told_at=?, bank_told_date='2026-12-20', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [nowUtcIso(), h]);
    expect(await startCardPayment(t, { confirmTold: true })).toHaveProperty('url');
    expect(lastParams().get('line_items[0][price_data][unit_amount]')).toBe('26500');
    expect(await openRows(h)).toEqual([{ amount: 26500, stripe_session_id: `cs_test_${createCalls()}`, status: 'open' }]);
  });
  it('支払いの鍵が閉じていれば not_open（pay_ok_at が空）', async () => {
    const { hid: h, token: t } = await newHousehold('t-pay-closed');
    const before = createCalls();
    expect(await startCardPayment(t, {})).toEqual({ blocked: 'not_open' });
    expect(createCalls()).toBe(before);
    expect(await openRows(h)).toEqual([]);
  });
  it('残り0なら nothing_due', async () => {
    const { hid: h, token: t } = await newHousehold();
    await recordManualPayment(h, { method: 'cash', amount: 26500, paidOn: '2026-12-20', memo: '試し' }, '試し');
    expect(await startCardPayment(t, {})).toEqual({ blocked: 'nothing_due' });
  });
  it('sync：払い終わっていたら1回だけ記録（source=stripe_recheck・pi も入る）', async () => {
    const { hid: hid5 } = await newHousehold();
    await seedOpenCheckout(hid5, { sessionId: 'cs_test_9', amount: 26500 });
    stripeState('cs_test_9', { status: 'complete', payment_status: 'paid', amount_total: 26500, payment_intent: 'pi_9' });
    await syncCardCheckout(hid5); await syncCardCheckout(hid5);
    expect(await payments(hid5)).toEqual([{ method: 'card', amount: 26500, source: 'stripe_recheck', stripe_session_id: 'cs_test_9', stripe_pi_id: 'pi_9' }]);
    expect((await checkout('cs_test_9')).status).toBe('paid');
    expect((await checkout('cs_test_9')).stripe_pi_id).toBe('pi_9');
  });
  it('sync：同じ決済の入金がもう有れば二重に書かない（行は paid にする）', async () => {
    const { hid: h } = await newHousehold();
    await withWriteTx((tx) => insertPaymentTx(tx, { householdId: h, method: 'card', amount: 26500, paidOn: '2026-12-21', source: 'stripe_webhook', stripeEventId: 'evt_d', stripeSessionId: 'cs_test_d', stripePiId: 'pi_d' }, 'system'));
    await seedOpenCheckout(h, { sessionId: 'cs_test_d', amount: 26500 });
    stripeState('cs_test_d', { status: 'complete', payment_status: 'paid', amount_total: 26500, payment_intent: 'pi_d' });
    await syncCardCheckout(h);
    expect(await payments(h)).toHaveLength(1);
    expect((await checkout('cs_test_d')).status).toBe('paid');
  });
  it('sync：切れていたら expired', async () => {
    const { hid: h } = await newHousehold();
    await seedOpenCheckout(h, { sessionId: 'cs_test_e', amount: 26500 });
    stripeState('cs_test_e', { status: 'expired', url: null });
    await syncCardCheckout(h);
    expect((await checkout('cs_test_e')).status).toBe('expired');
    expect(await payments(h)).toEqual([]);
  });
  it('sync：聞けなかったら throw（入金も状態も変えない）', async () => {
    const { hid: h } = await newHousehold();
    await seedOpenCheckout(h, { sessionId: 'cs_test_f', amount: 26500 });
    stripeState('cs_test_f', 'fail');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(syncCardCheckout(h)).rejects.toThrow();
    } finally {
      err.mockRestore();
    }
    expect((await checkout('cs_test_f')).status).toBe('open');
    expect(await payments(h)).toEqual([]);
  });
  it('「払う」の時も先に聞く：聞けなければ throw・払い終わっていれば nothing_due', async () => {
    const { hid: h, token: t } = await newHousehold();
    await seedOpenCheckout(h, { sessionId: 'cs_test_g', amount: 26500 });
    stripeState('cs_test_g', 'fail');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(startCardPayment(t, {})).rejects.toThrow();
    } finally {
      err.mockRestore();
    }
    stripeState('cs_test_g', { status: 'complete', payment_status: 'paid', amount_total: 26500, payment_intent: 'pi_g' });
    expect(await startCardPayment(t, {})).toEqual({ blocked: 'nothing_due' });
    expect(await payments(h)).toHaveLength(1);
  });
  // ---- ここから下は、計画の試験のあとに足した分（番号 cs_test_<n> がぶつからないよう後ろに置く） ----
  it('作っている途中の行（番号がまだ空・60秒以内）があれば作らずに throw、60秒より前の物は閉じて作る', async () => {
    const { hid: h7, token: t7 } = await newHousehold();
    await execute("INSERT INTO recital_checkouts (event_key, household_id, amount, status, created_at) VALUES ('t-pay', ?, 26500, 'open', ?)", [h7, nowUtcIso()]);
    const before = createCalls();
    await expect(startCardPayment(t7, {})).rejects.toThrow();
    await syncCardCheckout(h7);                            // sync も60秒以内の空の行は閉じない
    expect(await openRows(h7)).toEqual([{ amount: 26500, stripe_session_id: null, status: 'open' }]);
    expect(createCalls()).toBe(before);
    await execute("UPDATE recital_checkouts SET created_at = ? WHERE household_id = ? AND status = 'open'", [new Date(Date.now() - 61_000).toISOString(), h7]);
    expect(await startCardPayment(t7, {})).toHaveProperty('url');
    expect(await openRows(h7)).toHaveLength(1);
    expect((await openRows(h7))[0].stripe_session_id).not.toBeNull();
  });
  it('番号を書く前にほかで閉じられていたら、作った画面をすぐ切って throw', async () => {
    const { hid: h8, token: t8 } = await newHousehold();
    const realFetch = globalThis.fetch;
    // 作る（POST）の応答の前に、開いている行を閉じる（ほかのタブ・afterMoneyChanged が先に閉じた形）
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST' && url === API) {
        await execute("UPDATE recital_checkouts SET status = 'closed' WHERE household_id = ? AND status = 'open'", [h8]);
      }
      return realFetch(url, init);
    }));
    try {
      await expect(startCardPayment(t8, {})).rejects.toThrow();
    } finally {
      vi.stubGlobal('fetch', realFetch);
    }
    const sid = `cs_test_${createCalls()}`;
    expect(expireCalls()).toContain(sid);
    expect(await openRows(h8)).toEqual([]);
  });
  it('作れなかったら行を closed にして throw', async () => {
    const { hid: h9, token: t9 } = await newHousehold();
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST' && url === API) return jsonRes(400, { error: { code: 'parameter_invalid' } });
      return realFetch(url, init);
    }));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(startCardPayment(t9, {})).rejects.toThrow();
    } finally {
      vi.stubGlobal('fetch', realFetch);
      err.mockRestore();
    }
    expect(await openRows(h9)).toEqual([]);
    expect(Number((await core.getOne("SELECT COUNT(*) AS n FROM recital_checkouts WHERE household_id = ? AND status = 'closed'", [h9])).n)).toBe(1);
  });
  it('お預かりの返す分が残り以上なら refund_hold', async () => {
    const { hid: h, token: t } = await newHousehold();
    await recordManualPayment(h, { method: 'cash', amount: 26500, paidOn: '2026-12-20', memo: '試し' }, '試し');
    await withWriteTx((tx) => money.createRefundTx(tx, { householdId: h, amount: 26500, reasonNo: 4, reason: '試し', createdBy: '試し' }));
    expect(await startCardPayment(t, {})).toEqual({ blocked: 'refund_hold' });
  });
  it('鍵の合わない URL は throw', async () => {
    await expect(startCardPayment('0'.repeat(48), {})).rejects.toThrow();
    await expect(startCardPayment('bad', {})).rejects.toThrow();
  });
  it('読んでから行を入れるまでに入金が入ったら、古い額で作らずに busy（作り直さない・行も増えない）', async () => {
    const { hid: h, token: t } = await newHousehold();
    // 開いている行（Stripe では開いているが url が無い）→ 6 で切る → 切る呼び出しの間にスタッフの入金が入る形
    await seedOpenCheckout(h, { sessionId: 'cs_test_race', amount: 26500 });
    stripeState('cs_test_race', { status: 'open', url: null });
    const realFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'POST' && url.endsWith('/cs_test_race/expire')) {
        // afterMoneyChanged が走る前の入金（開いている行はもう閉じているので、afterMoneyChanged は何もしない）
        await withWriteTx((tx) => insertPaymentTx(tx, { householdId: h, method: 'cash', amount: 1000, paidOn: '2026-12-21', source: 'manual', confirmedBy: '試し' }, '試し'));
      }
      return realFetch(url, init);
    }));
    const before = createCalls();
    try {
      await expect(startCardPayment(t, {})).rejects.toMatchObject({ code: 'busy' });
    } finally {
      vi.stubGlobal('fetch', realFetch);
    }
    expect(createCalls()).toBe(before);
    expect(await openRows(h)).toEqual([]);
    expect(Number((await core.getOne('SELECT COUNT(*) AS n FROM recital_checkouts WHERE household_id = ?', [h])).n)).toBe(1);
    // もう一度押せば、新しい額で作る（番号が種の cs_test_9 などとぶつからないよう、数えを先へ進める）
    stripe.n = Math.max(stripe.n, 100);
    await startCardPayment(t, {});
    expect(lastParams().get('line_items[0][price_data][unit_amount]')).toBe('25500');
  });
  it('聞く・切るの鍵は決済の画面の番号（cs_live_／cs_test_）で選ぶ（stripe_mode を変えても置き去りにしない）', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_dummy');
    try {
      const { hid: h } = await newHousehold();   // t-pay は stripe_mode=test
      await seedOpenCheckout(h, { sessionId: 'cs_live_k1', amount: 26500 });
      await syncCardCheckout(h);
      expect(stripe.auth.get('GET cs_live_k1')).toBe('Bearer sk_live_dummy');
      await pay.expireOpenCheckout(h, '試し');
      expect(stripe.auth.get('POST cs_live_k1')).toBe('Bearer sk_live_dummy');
      const { hid: h2 } = await newHousehold();
      await seedOpenCheckout(h2, { sessionId: 'cs_test_k2', amount: 26500 });
      await syncCardCheckout(h2);
      expect(stripe.auth.get('GET cs_test_k2')).toBe('Bearer sk_test_dummy');
    } finally {
      vi.unstubAllEnvs();
      process.env.STRIPE_TEST_SECRET_KEY = 'sk_test_dummy';
    }
  });
});

// =====================================================================
describe('Task 22 カードの知らせの記録', () => {
  type Ev = import('../recitalStripe').RecitalWebhookEvent;
  let hid = 0;
  let liveHid = 0;
  let evSeq = 0;
  const openCheckoutOf: Record<number, number> = {};

  beforeAll(async () => {
    // 送る口に鍵が有ると、本物のメールを送りに行ってしまう（この試験は「送れない」前提）
    expect(isMailConfigured()).toBe(false);
    mailMode.real = true;
    ({ hid: liveHid } = await newHousehold('t-pay-live'));
  });
  afterAll(() => {
    mailMode.real = false;
  });
  beforeEach(async () => {
    ({ hid } = await newHousehold());
    openCheckoutOf[hid] = await seedOpenCheckout(hid, { sessionId: 'cs_test_' + hid, amount: 26500 });
    vi.mocked(notifyTaro).mockClear();
  });

  /** RecitalWebhookEvent を組む（番号は世帯ごとに cs_test_<世帯>・pi_<世帯>） */
  function ev(over: Partial<Ev> = {}): Ev {
    const householdId = over.householdId ?? hid;
    return {
      eventId: `evt_auto_${++evSeq}`, eventKey: 't-pay', householdId, checkoutId: openCheckoutOf[householdId] ?? null,
      sessionId: 'cs_test_' + householdId, piId: 'pi_' + householdId, amountTotal: 26500, paymentStatus: 'paid',
      type: 'checkout.session.completed', livemode: false, ...over,
    };
  }
  /** Stripe の checkout.session.completed の形の生の知らせ */
  function stripeEvent(over: { id?: string; amount_total?: number | null; householdId?: number } = {}) {
    const householdId = over.householdId ?? hid;
    const meta: Record<string, string> = { recital_event_key: 't-pay', recital_household_id: String(householdId) };
    if (openCheckoutOf[householdId] != null) meta.recital_checkout_id = String(openCheckoutOf[householdId]);
    return {
      id: over.id ?? `evt_auto_${++evSeq}`, object: 'event', type: 'checkout.session.completed', livemode: false,
      data: { object: {
        id: 'cs_test_' + householdId, object: 'checkout.session', payment_intent: 'pi_' + householdId,
        amount_total: 'amount_total' in over ? over.amount_total : 26500, payment_status: 'paid', status: 'complete', metadata: meta,
      } },
    };
  }
  async function payments(h: number) {
    const rows = await core.getAll('SELECT id, method, amount, source, stripe_event_id, stripe_session_id FROM recital_payments WHERE household_id = ? ORDER BY id', [h]);
    return rows.map((r) => ({ id: Number(r.id), method: String(r.method), amount: Number(r.amount), source: String(r.source), stripe_event_id: r.stripe_event_id, stripe_session_id: r.stripe_session_id }));
  }
  async function refundsTodo(h: number) {
    const rows = await core.getAll("SELECT amount, reason_no FROM recital_refunds WHERE household_id = ? AND status = 'todo' ORDER BY id", [h]);
    return rows.map((r) => ({ amount: Number(r.amount), reason_no: Number(r.reason_no) }));
  }
  async function mailKinds(h: number) {
    return (await core.getAll('SELECT mail_kind FROM recital_mail_log WHERE household_id = ? ORDER BY id', [h])).map((r) => String(r.mail_kind));
  }

  it('同じ知らせ2回で入金1回', async () => {
    expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_a' }))).status).toBe('paid');
    expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_a' }))).status).toBe('duplicate');
    expect(await payments(hid)).toHaveLength(1);
  });
  it('同じ画面の別の知らせ（マイページで先に記録ずみ）も duplicate', async () => {
    stripeState('cs_test_' + hid, { status: 'complete', payment_status: 'paid', amount_total: 26500, payment_intent: 'pi_' + hid });
    await syncCardCheckout(hid);
    expect(await payments(hid)).toHaveLength(1);
    expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_b' }))).status).toBe('duplicate');   // 同じ sessionId
    expect(await payments(hid)).toHaveLength(1);
  });
  it('試しの鍵の知らせは本番の鍵の発表会に当たらない（mode_mismatch・何も書かない）', async () => {
    expect((await applyRecitalWebhookEvent(ev({ eventKey: 't-pay-live', householdId: liveHid, livemode: false }))).status).toBe('mode_mismatch');
    expect(await payments(liveHid)).toHaveLength(0);
    expect((await applyRecitalWebhookEvent(ev({ livemode: true }))).status).toBe('mode_mismatch'); // 逆も
    expect(await payments(hid)).toHaveLength(0);
  });
  it('払い済みでない完了・charge.* は acked で何も書かない', async () => {
    expect((await applyRecitalWebhookEvent(ev({ paymentStatus: 'unpaid' }))).status).toBe('acked');
    expect((await applyRecitalWebhookEvent(ev({ type: 'charge.refunded', sessionId: null }))).status).toBe('acked');
    expect(await payments(hid)).toHaveLength(0);
  });
  it('期限切れの知らせは行を expired', async () => {
    expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_exp', type: 'checkout.session.expired', paymentStatus: 'unpaid', amountTotal: null }))).status).toBe('expired');
    expect((await core.getOne('SELECT status s FROM recital_checkouts WHERE stripe_session_id=?', ['cs_test_' + hid])).s).toBe('expired');
    expect(await payments(hid)).toHaveLength(0);
  });
  it('印の発表会と世帯の発表会がちがえば not_found', async () => {
    expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_o', eventKey: 't-other' }))).status).toBe('not_found');
    expect(await payments(hid)).toHaveLength(0);
  });
  it('本物の額で記録・こえた分は返す分の1番（古い画面で 30,000 払えた）', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await applyRecitalWebhookEvent(ev({ eventId: 'evt_c', amountTotal: 30000 }));
    } finally {
      err.mockRestore();
    }
    expect((await payments(hid))[0].amount).toBe(30000);
    expect(await refundsTodo(hid)).toEqual([{ amount: 3500, reason_no: 1 }]);
  });
  it('振込で払い終わった世帯にカードの完了の知らせ → 入金 26,500 を記録・返す分1番 26,500（source_payment_id はカードの入金）・完了メールは出ない', async () => {
    const { hid: h7 } = await newHousehold();
    await withWriteTx((tx) => insertPaymentTx(tx, { householdId: h7, method: 'bank', amount: 26500, paidOn: '2026-12-20', source: 'bank_staff' }, '試し'));
    const r = await handleRecitalWebhook(stripeEvent({ id: 'evt_f', householdId: h7 }));
    expect(r).toMatchObject({ handled: true, httpStatus: 200 });
    const card = (await payments(h7)).find((p) => p.method === 'card');
    expect(card?.amount).toBe(26500);
    const ref = await getOne('SELECT amount, reason_no, source_payment_id FROM recital_refunds WHERE household_id=? AND status=?', [h7, 'todo']);
    expect([Number(ref.amount), Number(ref.reason_no), Number(ref.source_payment_id)]).toEqual([26500, 1, card!.id]);
    expect(await mailKinds(h7)).not.toContain('complete');
  });
  it('handleRecitalWebhook：発表会でない知らせは handled:false', async () => {
    expect(await handleRecitalWebhook({ id: 'evt_m', type: 'checkout.session.completed', data: { object: { metadata: { mocchin_entry_id: '1', mocchin_step: '0' } } } })).toEqual({ handled: false });
  });
  it('handleRecitalWebhook：記録したらメールを呼び、メールが失敗しても 200', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let r;
    try {
      r = await handleRecitalWebhook(stripeEvent({ id: 'evt_d22' }));  // メールの鍵が無い試験環境＝送れない（計画の evt_d は 21 の種の入金と同じ番号なので変えた）
    } finally {
      err.mockRestore();
    }
    expect(r).toEqual({ handled: true, httpStatus: 200, result: 'recital_paid' });
    expect(await mailKinds(hid)).toContain('complete');
  });
  it('handleRecitalWebhook：適用に失敗したら 500（金額の無い完了の知らせ）', async () => {
    expect(await handleRecitalWebhook(stripeEvent({ id: 'evt_e', amount_total: null }))).toMatchObject({ handled: true, httpStatus: 500 });
    expect(await payments(hid)).toHaveLength(0);
  });
  // ---- ここから下は、計画の試験のあとに足した分 ----
  it('払っている間にこちらで行を閉じても（expireOpenCheckout）、Stripe の完了の知らせで入金を記録し、行は paid', async () => {
    await pay.expireOpenCheckout(hid, '試し');
    expect((await checkout('cs_test_' + hid)).status).toBe('closed');
    const r = await handleRecitalWebhook(stripeEvent({ id: 'evt_late' }));
    expect(r).toEqual({ handled: true, httpStatus: 200, result: 'recital_paid' });
    expect(await payments(hid)).toEqual([expect.objectContaining({ method: 'card', amount: 26500, source: 'stripe_webhook', stripe_event_id: 'evt_late', stripe_session_id: 'cs_test_' + hid })]);
    const c = await checkout('cs_test_' + hid);
    expect([String(c.status), String(c.stripe_pi_id)]).toEqual(['paid', 'pi_' + hid]);
    expect(await openRows(hid)).toEqual([]);
  });
  it('印の checkout の番号が無くても、決済の画面の番号で行を見つけて paid にする', async () => {
    expect((await applyRecitalWebhookEvent(ev({ eventId: 'evt_nocid', checkoutId: null }))).status).toBe('paid');
    expect((await checkout('cs_test_' + hid)).status).toBe('paid');
  });
  it('まとめられた世帯の知らせは、まとめ先の世帯に記録する（お金は落とさない）', async () => {
    const { hid: target } = await newHousehold();
    await execute("UPDATE recital_households SET status = 'merged', merged_into = ? WHERE id = ?", [target, hid]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let r;
    try {
      r = await applyRecitalWebhookEvent(ev({ eventId: 'evt_merged' }));
    } finally {
      err.mockRestore();
    }
    expect(r).toMatchObject({ status: 'paid', householdId: target });
    expect(await payments(target)).toHaveLength(1);
    expect(await payments(hid)).toHaveLength(0);
    expect((await checkout('cs_test_' + hid)).status).toBe('paid');
    expect(vi.mocked(notifyTaro)).not.toHaveBeenCalled();      // active のまとめ先までたどれたので知らせない
  });
  it('payment_intent.* は acked で何も書かない', async () => {
    expect((await applyRecitalWebhookEvent(ev({ type: 'payment_intent.succeeded', sessionId: null }))).status).toBe('acked');
    expect(await payments(hid)).toHaveLength(0);
  });
  it('適用の失敗は TARO に知らせる（題・本文に名前と金額を書かない）。知らせが失敗しても 500 を返す', async () => {
    vi.mocked(notifyTaro).mockRejectedValueOnce(new Error('all failed'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await handleRecitalWebhook(stripeEvent({ id: 'evt_g', amount_total: null }))).toEqual({ handled: true, httpStatus: 500, result: 'recital_apply_failed' });
    } finally {
      err.mockRestore();
    }
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledWith({ subject: 'カードの入金の記録に失敗しました', body: 'Stripe が送り直します。知らせの番号 evt_g', subjectPrefix: '【BOOM】BW6' });
  });
  // ---- 見直し1回目で足した分：記録できない払い終わった完了は TARO に知らせる ----
  const notifyCalls = () => JSON.stringify(vi.mocked(notifyTaro).mock.calls);
  async function quiet<T>(f: () => Promise<T>): Promise<T> {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      return await f();
    } finally {
      err.mockRestore();
    }
  }
  it('本番の払い終わった完了が試しの設定の発表会に来たら（mode_mismatch）200 のまま TARO に知らせる（名前・金額なし）', async () => {
    const r = await quiet(() => handleRecitalWebhook({ ...stripeEvent({ id: 'evt_mm_live' }), livemode: true }));
    expect(r).toEqual({ handled: true, httpStatus: 200, result: 'recital_mode_mismatch' });
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledWith({
      subject: 'カードの入金を記録できませんでした（設定とちがう）', body: `知らせの番号 evt_mm_live・世帯の番号 ${hid}`, subjectPrefix: '【BOOM】BW6',
    });
    expect(notifyCalls()).not.toMatch(/26500|26,500|テスト|ハハ|イチ|example/);
    expect(await payments(hid)).toHaveLength(0);
  });
  it('世帯が見つからない払い終わった完了も 200 のまま TARO に知らせる', async () => {
    const r = await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_nf', householdId: 999999 })));
    expect(r.status).toBe('not_found');
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledWith({
      subject: 'カードの入金を記録できませんでした（世帯が見つからない）', body: '知らせの番号 evt_nf・世帯の番号 999999', subjectPrefix: '【BOOM】BW6',
    });
    vi.mocked(notifyTaro).mockClear();
    await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_nf2', eventKey: 't-other' })));   // 印の発表会がちがう
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledTimes(1);
  });
  it('知らせが失敗しても 200 のまま（mode_mismatch）', async () => {
    vi.mocked(notifyTaro).mockRejectedValueOnce(new Error('all failed'));
    expect((await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_mm_fail', livemode: true })))).status).toBe('mode_mismatch');
  });
  it('払い済みでない・切れた知らせは、記録できなくても知らせない', async () => {
    await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_q1', livemode: true, paymentStatus: 'unpaid' })));
    await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_q2', livemode: true, type: 'checkout.session.expired', paymentStatus: 'unpaid', amountTotal: null })));
    await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_q3', householdId: 999999, type: 'checkout.session.expired', paymentStatus: 'unpaid', amountTotal: null })));
    await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_q4', householdId: 999999, type: 'charge.refunded', sessionId: null })));
    expect(vi.mocked(notifyTaro)).not.toHaveBeenCalled();
  });
  it('まとめ先が別の発表会ならたどらず、たどれた所（元の世帯）に記録して TARO に知らせる', async () => {
    await execute("UPDATE recital_households SET status = 'merged', merged_into = ? WHERE id = ?", [liveHid, hid]);
    const r = await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_mb1' })));
    expect(r).toMatchObject({ status: 'paid', householdId: hid });
    expect(await payments(hid)).toHaveLength(1);
    expect(await payments(liveHid)).toHaveLength(0);
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledWith({
      subject: 'まとめた世帯のまとめ先をたどれませんでした（カードの入金はたどれた所の世帯に記録）',
      body: `知らせの番号 evt_mb1・世帯の番号 ${hid}・記録した世帯の番号 ${hid}`, subjectPrefix: '【BOOM】BW6',
    });
    expect(notifyCalls()).not.toMatch(/26500|26,500|テスト|ハハ|イチ|example/);
    // 同じ知らせの送り直し（duplicate）では2回知らせない
    vi.mocked(notifyTaro).mockClear();
    expect((await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_mb1' })))).status).toBe('duplicate');
    expect(vi.mocked(notifyTaro)).not.toHaveBeenCalled();
  });
  it('まとめ先が輪になっていても止まり、TARO に知らせる', async () => {
    const { hid: h2 } = await newHousehold();
    await execute("UPDATE recital_households SET status = 'merged', merged_into = ? WHERE id = ?", [h2, hid]);
    await execute("UPDATE recital_households SET status = 'merged', merged_into = ? WHERE id = ?", [hid, h2]);
    const r = await quiet(() => applyRecitalWebhookEvent(ev({ eventId: 'evt_mb2' })));
    expect(r.status).toBe('paid');
    expect((await payments(hid)).length + (await payments(h2)).length).toBe(1);
    expect(vi.mocked(notifyTaro)).toHaveBeenCalledTimes(1);
    expect(notifyCalls()).toContain('まとめ先をたどれませんでした');
  });
});
