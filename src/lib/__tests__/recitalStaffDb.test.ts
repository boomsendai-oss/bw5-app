// BW6 発表会（段階1）の recitalStaffDb.ts（世帯をまとめる・特別な料金ボタン・そのほかの金額の直し・照合を決める。Task 20）の試験。
// 実 DB（試験用のファイル DB ./data/test_recital_staff_db.db）。試験ごとに自分の発表会のキー（t-sd-…）の行だけを見る。
// メール（10）とカードの決済の画面を切る所（21）は mock する（本物の送信・Stripe は呼ばない）。
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { RECITAL_STAFF_NAMES } from '../recital';
import { seedEvent, seedHousehold, seedMember, seedRules, seedWork, type SeedPerson } from './recitalStaffSeed';

// 2つの書き方は同じファイルを指し、あとの vi.mock が勝つので、両方を同じ中身にする
const mailMock = () => ({
  sendRecitalMail: vi.fn(async () => ({ status: 'sent', logId: 1 })),
  sendPaidMail: vi.fn(async () => ({ status: 'none' })),
  maybeResendBankGuide: vi.fn(async () => {}),
});
vi.mock('@/lib/recitalMail', () => mailMock());
vi.mock('@/lib/recitalMail.ts', () => mailMock());
const payMock = () => ({ expireOpenCheckout: vi.fn(async () => {}) });
vi.mock('@/lib/recitalPayDb', () => payMock());
vi.mock('@/lib/recitalPayDb.ts', () => payMock());

const TEST_DB = './data/test_recital_staff_db.db';
process.env.TURSO_DATABASE_URL = `file:${TEST_DB}`;
delete process.env.TURSO_AUTH_TOKEN;
delete process.env.SKIP_DB_INIT;

let core: typeof import('../db');
let money: typeof import('../recitalMoneyDb');
let staff: typeof import('../recitalStaffDb');
let entry: typeof import('../recitalEntryDb');
let mail: typeof import('../recitalMail');
let pay: typeof import('../recitalPayDb');

beforeAll(async () => {
  for (const s of ['', '-shm', '-wal']) { try { rmSync(TEST_DB + s); } catch { /* 初回 */ } }
  core = await import('../db');
  money = await import('../recitalMoneyDb');
  staff = await import('../recitalStaffDb');
  entry = await import('../recitalEntryDb');
  mail = await import('../recitalMail');
  pay = await import('../recitalPayDb');
  await core.initDb();
  const dir = 'scripts/migrations';
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    for (const stmt of sql.split(';').map((x) => x.trim()).filter(Boolean)) {
      try { await core.execute(stmt); } catch { /* 依存の無いものは飛ばす */ }
    }
  }
});

const N = RECITAL_STAFF_NAMES[0];
const total = async (h: number) => (await money.readHouseholdMoney(h)).m;

const seeded = new Map<string, { W1: number; W2: number }>();
/** 世帯1つ。casts の 'W1'/'W2' はその発表会の作品。すべて 'in'。first は1人目の人の欄に重ねる（照合の試験用） */
async function one(
  ev: string, casts: ('W1' | 'W2')[][], payments: number[] = [], first: Partial<SeedPerson> = {}, rest: Partial<SeedPerson>[] = [],
): Promise<{ h: number; p: number[] }> {
  let w = seeded.get(ev);
  if (!w) {
    await seedEvent(ev);
    await seedRules(ev);
    w = { W1: await seedWork(ev, 'W01'), W2: await seedWork(ev, 'W02') };
    seeded.set(ev, w);
  }
  const ws = w;
  const people: SeedPerson[] = casts.map((cs, i) => ({
    ...(i === 0 ? first : rest[i - 1] ?? {}),
    casts: cs.map((c) => [ws[c], 'in'] as [number, 'in']),
  }));
  const r = await seedHousehold(ev, { recompute: true, payments, people });
  return { h: r.householdId, p: r.personIds };
}

const count = async (sql: string, args: (string | number)[]) => Number((await core.getOne(sql, args))?.n);

describe('setFeeClass（特別な料金ボタン。5-1・5-7 の例）', () => {
  it('払った 1人1作品（26,500）を「協力チケットなし」に → 19,000、返す分 7,500（3番）', async () => {
    const { h, p } = await one('t-sd-1', [['W1']], [26500]);
    const r = await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N);
    expect(r).toMatchObject({ changed: true, totalBefore: 26500, totalAfter: 19000, refund: 7500, extra: 0 });
    expect(await core.getOne(`SELECT amount, reason_no, status FROM recital_refunds WHERE household_id=?`, [h])).toMatchObject({ amount: 7500, reason_no: 3, status: 'todo' });
    expect(await total(h)).toMatchObject({ total: 19000, paid: 19000, remaining: 0 });
  });
  it('未払いなら返す分は作らない（Tシャツ代だけ → 3,000）', async () => {
    const { h, p } = await one('t-sd-2', [['W1']]);
    expect(await staff.setFeeClass(p[0], 'tshirt_only', '登録もれ', N)).toMatchObject({ changed: true, totalBefore: 26500, totalAfter: 3000, refund: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id=?`, [h]))?.n).toBe(0);
  });
  it('兄2・妹1（37,500）で妹を「Tシャツ代だけ」→ 1人目が兄に入れかわり 35,500', async () => {
    const { h, p } = await one('t-sd-3', [['W1', 'W2'], ['W1']]);
    expect(await total(h)).toMatchObject({ total: 37500 });
    expect(await staff.setFeeClass(p[1], 'tshirt_only', '登録もれ', N)).toMatchObject({ totalAfter: 35500 });
  });
  it('同じ種類をもう一度 → changed:false、記録は増えない', async () => {
    const { h, p } = await one('t-sd-4', [['W1']]);
    await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N);
    const n = (await core.getOne(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=?`, [h]))?.n;
    expect(await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N)).toMatchObject({ changed: false, totalBefore: 19000, totalAfter: 19000, refund: 0, extra: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=?`, [h]))?.n).toBe(n);
  });
  it('払った 19,000（協力チケットなし）を「ふつう」に戻す → 26,500、追加分 7,500、返す分なし', async () => {
    const { h, p } = await one('t-sd-5', [['W1']]);
    await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N);
    await money.recordManualPayment(h, { method: 'cash', amount: 19000, paidOn: '2026-12-20', memo: '' }, N);
    expect(await staff.setFeeClass(p[0], null, '戻した', N)).toMatchObject({ totalAfter: 26500, extra: 7500, refund: 0 });
    expect((await money.readHouseholdMoney(h)).view).toBe('complete_extra');
  });
  it('dryRun は同じ数を返し、DB は変わらない', async () => {
    const { h, p } = await one('t-sd-6', [['W1']], [26500]);
    const before = await core.getAll(`SELECT * FROM recital_charges WHERE household_id=?`, [h]);
    const changes = await count(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=?`, [h]);
    expect(await staff.setFeeClass(p[0], 'no_coop', '試し', N, { dryRun: true })).toMatchObject({ totalAfter: 19000, refund: 7500 });
    expect(await core.getAll(`SELECT * FROM recital_charges WHERE household_id=?`, [h])).toEqual(before);
    expect((await core.getOne(`SELECT fee_class_override f FROM recital_people WHERE id=?`, [p[0]]))?.f).toBeNull();
    expect(await count(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id=?`, [h])).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=?`, [h])).toBe(changes);
  });
  it('名前が無ければ throw', async () => {
    const { p } = await one('t-sd-7', [['W1']]);
    await expect(staff.setFeeClass(p[0], 'no_coop', '登録もれ', '')).rejects.toThrow('staff_name');
  });
  it('理由が空なら throw・知らない種類は throw', async () => {
    const { p } = await one('t-sd-7b', [['W1']]);
    await expect(staff.setFeeClass(p[0], 'no_coop', '  ', N)).rejects.toThrow('reason');
    await expect(staff.setFeeClass(p[0], 'half' as never, '登録もれ', N)).rejects.toThrow('fee_class');
  });
  it('変えた記録は fee_class_set（前後の種類と理由）、合計が変わったら変更の控えを送る', async () => {
    const { h, p } = await one('t-sd-8', [['W1']]);
    vi.mocked(mail.sendRecitalMail).mockClear();
    await staff.setFeeClass(p[0], 'free', '登録もれ', N);
    const c = await core.getOne(`SELECT before_json, after_json, reason, actor, is_exception FROM recital_changes WHERE household_id=? AND action='fee_class_set'`, [h]);
    expect(JSON.parse(String(c?.before_json))).toEqual({ feeClass: null });
    expect(JSON.parse(String(c?.after_json))).toEqual({ feeClass: 'free' });
    expect(c).toMatchObject({ reason: '登録もれ', actor: N, is_exception: 0 });
    expect(vi.mocked(mail.sendRecitalMail)).toHaveBeenCalledWith({ kind: 'change', householdId: h });
  });
  it('設計書の例：親1・子1（34,500）で親を「Tシャツ代だけ」→ 29,500', async () => {
    const { h, p } = await one('t-sd-9', [['W1'], ['W1']], [], {}, [{ category: 'non_member' }]);
    expect(await total(h)).toMatchObject({ total: 34500 });
    expect(await staff.setFeeClass(p[1], 'tshirt_only', '保護者', N)).toMatchObject({ changed: true, totalBefore: 34500, totalAfter: 29500 });
  });
  it('まとめた世帯の人は throw', async () => {
    const A = await one('t-sd-10', [['W1']]); const B = await one('t-sd-10', [['W1']]);
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [{ dropPersonId: B.p[0], keepPersonId: A.p[0] }] }, N);
    await expect(staff.setFeeClass(B.p[0], 'no_coop', '登録もれ', N)).rejects.toThrow('not_active');
  });
});

describe('そのほかの金額の直し（adjust。K228）', () => {
  it('26,500 を 1,000 下げる → 25,500（is_exception=1）／合計をこえて下げられない／取り消すと戻る／上げる', async () => {
    const { h } = await one('t-sd-a', [['W1']]);
    expect(await staff.addAdjustCharge(h, { direction: 'down', amount: 1000, reason: '試し' }, N)).toMatchObject({ ok: true, totalAfter: 25500 });
    expect(await staff.addAdjustCharge(h, { direction: 'down', amount: 30000, reason: '試し' }, N)).toEqual({ ok: false, code: 'over_total' });
    const adj = await core.getOne(`SELECT id, amount FROM recital_charges WHERE household_id=? AND item_code='adjust' AND status='active'`, [h]);
    expect(adj?.amount).toBe(-1000);
    expect((await core.getOne(`SELECT is_exception FROM recital_changes WHERE household_id=? AND action='adjust_add'`, [h]))?.is_exception).toBe(1);
    await staff.voidAdjustCharge(Number(adj!.id), 'まちがい', N);
    expect((await total(h)).total).toBe(26500);
    expect(await staff.addAdjustCharge(h, { direction: 'up', amount: 2000, reason: '試し' }, N)).toMatchObject({ totalAfter: 28500 });
  });
  it('行の形・total_changed の記録・取り消しの記録', async () => {
    const { h } = await one('t-sd-a2', [['W1']]);
    await staff.addAdjustCharge(h, { direction: 'down', amount: 500, reason: '試し' }, N);
    expect(await core.getOne(`SELECT ref, label, qty, unit_amount, amount, due_on FROM recital_charges WHERE household_id=? AND item_code='adjust'`, [h]))
      .toEqual({ ref: '', label: '手の調整', qty: 1, unit_amount: -500, amount: -500, due_on: '2027-02-10' });
    const tc = await core.getAll(`SELECT before_json, after_json FROM recital_changes WHERE household_id=? AND action='total_changed' ORDER BY id DESC LIMIT 1`, [h]);
    expect(JSON.parse(String(tc[0].before_json))).toEqual({ total: 26500 });
    expect(JSON.parse(String(tc[0].after_json))).toEqual({ total: 26000 });
    const adj = await core.getOne(`SELECT id FROM recital_charges WHERE household_id=? AND item_code='adjust'`, [h]);
    expect(await staff.voidAdjustCharge(Number(adj!.id), 'まちがい', N)).toEqual({ ok: true });
    expect(await core.getOne(`SELECT status, void_reason FROM recital_charges WHERE id=?`, [Number(adj!.id)])).toEqual({ status: 'void', void_reason: 'まちがい' });
    expect((await core.getOne(`SELECT is_exception FROM recital_changes WHERE household_id=? AND action='adjust_void'`, [h]))?.is_exception).toBe(1);
    // 2回目と、adjust でない行は取り消せない
    expect(await staff.voidAdjustCharge(Number(adj!.id), 'まちがい', N)).toEqual({ ok: false });
    const base = await core.getOne(`SELECT id FROM recital_charges WHERE household_id=? AND item_code='base' AND status='active'`, [h]);
    expect(await staff.voidAdjustCharge(Number(base!.id), 'まちがい', N)).toEqual({ ok: false });
  });
  it('0円・小数・理由が空は invalid／dryRun は書かない／払ったあとに下げても返す分は作らない（K217）', async () => {
    const { h } = await one('t-sd-a3', [['W1']], [26500]);
    expect(await staff.addAdjustCharge(h, { direction: 'down', amount: 0, reason: '試し' }, N)).toEqual({ ok: false, code: 'invalid' });
    expect(await staff.addAdjustCharge(h, { direction: 'up', amount: 1.5, reason: '試し' }, N)).toEqual({ ok: false, code: 'invalid' });
    expect(await staff.addAdjustCharge(h, { direction: 'up', amount: 100, reason: ' ' }, N)).toEqual({ ok: false, code: 'invalid' });
    expect(await staff.addAdjustCharge(h, { direction: 'down', amount: 1000, reason: '試し' }, N, { dryRun: true })).toEqual({ ok: true, totalBefore: 26500, totalAfter: 25500 });
    expect(await count(`SELECT COUNT(*) n FROM recital_charges WHERE household_id=? AND item_code='adjust'`, [h])).toBe(0);
    await staff.addAdjustCharge(h, { direction: 'down', amount: 1000, reason: '試し' }, N);
    expect(await count(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id=?`, [h])).toBe(0);
    expect(await total(h)).toMatchObject({ total: 25500, overpaid: 1000 });
  });
  it('特別な料金の確かめは、生きている adjust の和を返す', async () => {
    const { h, p } = await one('t-sd-a4', [['W1']]);
    await staff.addAdjustCharge(h, { direction: 'down', amount: 1000, reason: '試し' }, N);
    expect(await staff.setFeeClass(p[0], 'no_coop', '登録もれ', N, { dryRun: true })).toMatchObject({ totalBefore: 25500, totalAfter: 18000, adjustActive: -1000 });
  });
});

describe('mergeHouseholds（5-2・5-7 の例）', () => {
  it('別々に払った家族（26,500＋26,500）→ 34,500、返す分 18,500（2番）、入金は「調整」で移す', async () => {
    const A = await one('t-sd-m1', [['W1']], [26500]); const B = await one('t-sd-m1', [['W1']], [26500]);
    const r = await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    expect(r).toEqual({ ok: true, totalBefore: 53000, totalAfter: 34500, moved: 26500, refund: 18500 });
    expect(await core.getAll(`SELECT household_id, method, amount, memo FROM recital_payments WHERE event_key='t-sd-m1' AND memo='移した' ORDER BY amount`)).toEqual([
      { household_id: B.h, method: 'adjust', amount: -26500, memo: '移した' }, { household_id: A.h, method: 'adjust', amount: 26500, memo: '移した' }]);
    expect(await core.getOne(`SELECT status, merged_into FROM recital_households WHERE id=?`, [B.h])).toEqual({ status: 'merged', merged_into: A.h });
    expect(await core.getOne(`SELECT reason_no, amount FROM recital_refunds WHERE household_id=?`, [A.h])).toEqual({ reason_no: 2, amount: 18500 });
    expect(await total(A.h)).toMatchObject({ total: 34500, paid: 34500, remaining: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_charges WHERE household_id=? AND status='active'`, [B.h]))?.n).toBe(0);
  });
  it('まとめても両方の整理番号はそのまま', async () => {
    const A = await one('t-sd-m6', [['W1']]); const B = await one('t-sd-m6', [['W1']]);
    const refs = async () => (await core.getAll(`SELECT id, ref_code FROM recital_households WHERE id IN (?,?) ORDER BY id`, [A.h, B.h]));
    const before = await refs();
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    expect(await refs()).toEqual(before);
  });
  it('同じ子の二重（両方 26,500 済み）→ 26,500、返す分 26,500。片方の人は withdrawn・出演は out', async () => {
    const A = await one('t-sd-m2', [['W1']], [26500]); const B = await one('t-sd-m2', [['W1']], [26500]);
    const r = await staff.mergeHouseholds(B.h, A.h, { reason: '二重', samePeople: [{ dropPersonId: B.p[0], keepPersonId: A.p[0] }] }, N);
    expect(r).toMatchObject({ ok: true, totalAfter: 26500, refund: 26500 });
    expect(await core.getOne(`SELECT status, merged_into FROM recital_people WHERE id=?`, [B.p[0]])).toEqual({ status: 'withdrawn', merged_into: A.p[0] });
    expect((await core.getAll(`SELECT status FROM recital_casts WHERE person_id=?`, [B.p[0]])).every((c) => c.status === 'out')).toBe(true);
    expect(await core.getOne(`SELECT withdraw_reason FROM recital_casts WHERE person_id=?`, [B.p[0]])).toEqual({ withdraw_reason: '同じ人の二重（世帯をまとめた）' });
  });
  it('未払いどうし → 34,500。入金の行も返す分も作らない', async () => {
    const A = await one('t-sd-m3', [['W1']]); const B = await one('t-sd-m3', [['W1']]);
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: true, totalBefore: 53000, totalAfter: 34500, moved: 0, refund: 0 });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id IN (?,?)`, [A.h, B.h]))?.n).toBe(0);
    expect(await count(`SELECT COUNT(*) n FROM recital_payments WHERE household_id IN (?,?)`, [A.h, B.h])).toBe(0);
  });
  it('2回目は not_active（お金は動かない）／同じ世帯は same／もとに手の調整があれば has_adjust', async () => {
    const A = await one('t-sd-m4', [['W1']], [26500]); const B = await one('t-sd-m4', [['W1']], [26500]); const C = await one('t-sd-m4', [['W1']]);
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    const pays = (await core.getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id IN (?, ?)`, [A.h, B.h]))?.n;
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'not_active' });
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id IN (?, ?)`, [A.h, B.h]))?.n).toBe(pays);
    expect(await staff.mergeHouseholds(A.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'same' });
    await staff.addAdjustCharge(C.h, { direction: 'down', amount: 1000, reason: '試し' }, N);
    expect(await staff.mergeHouseholds(C.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'has_adjust' });
  });
  it('dryRun は数だけ返し、もとの世帯は active のまま', async () => {
    const A = await one('t-sd-m5', [['W1']], [26500]); const B = await one('t-sd-m5', [['W1']], [26500]);
    const pays = (await core.getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id IN (?, ?)`, [A.h, B.h]))?.n;
    vi.mocked(pay.expireOpenCheckout).mockClear();
    vi.mocked(mail.sendRecitalMail).mockClear();
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N, { dryRun: true })).toMatchObject({ ok: true, totalAfter: 34500, refund: 18500 });
    expect((await core.getOne(`SELECT status FROM recital_households WHERE id=?`, [B.h]))?.status).toBe('active');
    expect((await core.getOne(`SELECT COUNT(*) n FROM recital_payments WHERE household_id IN (?, ?)`, [A.h, B.h]))?.n).toBe(pays);
    expect(await count(`SELECT COUNT(*) n FROM recital_people WHERE household_id=?`, [B.h])).toBe(1);
    expect(await count(`SELECT COUNT(*) n FROM recital_refunds WHERE household_id IN (?, ?)`, [A.h, B.h])).toBe(0);
    expect(vi.mocked(pay.expireOpenCheckout)).not.toHaveBeenCalled();
    expect(vi.mocked(mail.sendRecitalMail)).not.toHaveBeenCalled();
  });
  it('まとめたあと：もとの開いている支払いを切り、両方に変更の控え・移した入金の記録は payment_recorded の形', async () => {
    const A = await one('t-sd-m7', [['W1']]); const B = await one('t-sd-m7', [['W1']], [26500]);
    vi.mocked(pay.expireOpenCheckout).mockClear();
    vi.mocked(mail.sendRecitalMail).mockClear();
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    expect(vi.mocked(pay.expireOpenCheckout)).toHaveBeenCalledWith(B.h, 'merged');
    expect(vi.mocked(mail.sendRecitalMail).mock.calls).toEqual([[{ kind: 'change', householdId: A.h }], [{ kind: 'change', householdId: B.h }]]);
    const rec = await core.getOne(`SELECT after_json FROM recital_changes WHERE household_id=? AND action='payment_recorded'`, [A.h]);
    const pid = await core.getOne(`SELECT id FROM recital_payments WHERE household_id=? AND memo='移した'`, [A.h]);
    expect(JSON.parse(String(rec?.after_json))).toEqual({
      paymentId: Number(pid?.id), method: 'adjust', amount: 26500, source: 'manual', bankRowId: null, refundId: null, memo: '移した', fromId: B.h, intoId: A.h,
    });
    const m = await core.getOne(`SELECT before_json, after_json, reason FROM recital_changes WHERE household_id=? AND action='household_merged'`, [A.h]);
    expect(JSON.parse(String(m?.before_json))).toEqual({ fromId: B.h, intoId: A.h, totalBefore: 53000 });
    expect(JSON.parse(String(m?.after_json))).toMatchObject({ totalAfter: 34500, refund: 0 });
    expect(m?.reason).toBe('家族');
    // まとめた入金は2行とも confirmed_by と今日の日
    expect(await count(`SELECT COUNT(*) n FROM recital_payments WHERE memo='移した' AND source='manual' AND confirmed_by=? AND household_id IN (?,?)`, [N, A.h, B.h])).toBe(2);
    expect(await count(`SELECT COUNT(*) n FROM event_ledger WHERE event_key='t-sd-m7'`, []).catch(() => 0)).toBe(0);
  });
  it('「振り込みました」の印：もとにあり先に無ければ写し、もとは空にする', async () => {
    const A = await one('t-sd-m8', [['W1']]); const B = await one('t-sd-m8', [['W1']]);
    await core.execute(
      `UPDATE recital_households SET bank_told_at='2026-12-20T01:00:00.000Z', bank_told_date='2026-12-20', bank_told_name='シケン', bank_told_amount=26500, bank_told_by='family' WHERE id=?`,
      [B.h],
    );
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    const cols = 'bank_told_at, bank_told_date, bank_told_name, bank_told_amount, bank_told_by';
    expect(await core.getOne(`SELECT ${cols} FROM recital_households WHERE id=?`, [A.h])).toEqual({
      bank_told_at: '2026-12-20T01:00:00.000Z', bank_told_date: '2026-12-20', bank_told_name: 'シケン', bank_told_amount: 26500, bank_told_by: 'family',
    });
    expect(await core.getOne(`SELECT ${cols} FROM recital_households WHERE id=?`, [B.h])).toEqual({
      bank_told_at: null, bank_told_date: null, bank_told_name: null, bank_told_amount: null, bank_told_by: null,
    });
    // 変えた記録には名義を入れない（日と金額だけ）
    const m = await core.getOne(`SELECT after_json FROM recital_changes WHERE household_id=? AND action='household_merged'`, [A.h]);
    expect(JSON.parse(String(m?.after_json)).told).toEqual({ moved: true, date: '2026-12-20', amount: 26500 });
    expect(String(m?.after_json)).not.toContain('シケン');
  });
  it('組がおかしい → bad_pair／発表会がちがう → other_event／もとに返す分 todo → has_refund_todo', async () => {
    const A = await one('t-sd-m9', [['W1']]); const B = await one('t-sd-m9', [['W1']]);
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '二重', samePeople: [{ dropPersonId: A.p[0], keepPersonId: B.p[0] }] }, N)).toEqual({ ok: false, code: 'bad_pair' });
    expect(await staff.mergeHouseholds(B.h, A.h, { reason: '二重', samePeople: [{ dropPersonId: B.p[0], keepPersonId: B.p[0] }] }, N)).toEqual({ ok: false, code: 'bad_pair' });
    const X = await one('t-sd-m9x', [['W1']]);
    expect(await staff.mergeHouseholds(X.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'other_event' });
    const C = await one('t-sd-m9', [['W1']], [30000]);
    await money.recordManualPayment(C.h, { method: 'cash', amount: 100, paidOn: '2026-12-20', memo: '' }, N);
    expect(await staff.mergeHouseholds(C.h, A.h, { reason: '家族', samePeople: [] }, N)).toEqual({ ok: false, code: 'has_refund_todo' });
    expect((await core.getOne(`SELECT status FROM recital_households WHERE id=?`, [B.h]))?.status).toBe('active');
  });
  it('まとめた世帯はメールアドレスを直せない（carried note b）', async () => {
    const A = await one('t-sd-m10', [['W1']]); const B = await one('t-sd-m10', [['W1']]);
    await staff.mergeHouseholds(B.h, A.h, { reason: '家族', samePeople: [] }, N);
    await expect(entry.changeHouseholdEmail(B.h, 'new-addr@example.com', N)).rejects.toThrow('not_active');
  });
});

describe('照合を決める（5-8）', () => {
  const preset = async (ev: string, memberId: number, feeClass: string) => {
    await core.execute(`INSERT INTO recital_fee_presets (event_key, member_id, fee_class, created_at, created_by) VALUES (?, ?, ?, ?, ?)`, [ev, memberId, feeClass, new Date().toISOString(), N]);
  };
  it('事前登録（協力チケットなし）の会員と結ぶ → manual・印が入り 19,000', async () => {
    const m = await seedMember({ fullName: '試験 一', kana: 'シケンイチ', birthday: '2015-04-01' });
    const { h, p } = await one('t-sd-c1', [['W1']], [], { lastKana: 'シケン', firstKana: 'イチ', birthday: '2015-04-01', matchStatus: 'pending' });
    await preset('t-sd-c1', m, 'no_coop');
    expect(await staff.decideMemberMatch(p[0], { memberId: m }, '確かめた', N)).toMatchObject({ presetClass: 'no_coop', keptClass: 'no_coop', totalAfter: 19000, changed: true });
    expect(await core.getOne(`SELECT member_id, match_status, fee_class_override FROM recital_people WHERE id=?`, [p[0]])).toEqual({ member_id: m, match_status: 'manual', fee_class_override: 'no_coop' });
    expect(await total(h)).toMatchObject({ total: 19000 });
    const c = await core.getOne(`SELECT after_json, reason FROM recital_changes WHERE person_id=? AND action='match_decided'`, [p[0]]);
    expect(JSON.parse(String(c?.after_json))).toEqual({ memberId: m, status: 'manual' });
    expect(c?.reason).toBe('確かめた');
    expect(await count(`SELECT COUNT(*) n FROM recital_changes WHERE household_id=? AND action='fee_class_set'`, [h])).toBe(1);
  });
  it('印がもう「参加費なし」なら変えない（K226）', async () => {
    const m = await seedMember({ fullName: '試験 二', kana: 'シケンニ', birthday: '2015-04-02' });
    const { p } = await one('t-sd-c2', [['W1']], [], { lastKana: 'シケン', firstKana: 'ニ', birthday: '2015-04-02', matchStatus: 'pending', feeClass: 'free' });
    await preset('t-sd-c2', m, 'no_coop');
    expect(await staff.decideMemberMatch(p[0], { memberId: m }, '確かめた', N)).toMatchObject({ changed: false, presetClass: 'no_coop', keptClass: 'free' });
    expect((await core.getOne(`SELECT fee_class_override f FROM recital_people WHERE id=?`, [p[0]]))?.f).toBe('free');
  });
  it('払ったあとに結んで下がった → 返す分 7,500（3番）', async () => {
    const m = await seedMember({ fullName: '試験 三', kana: 'シケンサン', birthday: '2015-04-03' });
    const { h, p } = await one('t-sd-c3', [['W1']], [26500], { lastKana: 'シケン', firstKana: 'サン', birthday: '2015-04-03', matchStatus: 'pending' });
    await preset('t-sd-c3', m, 'no_coop');
    expect(await staff.decideMemberMatch(p[0], { memberId: m }, '確かめた', N)).toMatchObject({ refund: 7500 });
    expect(await core.getOne(`SELECT amount, reason_no FROM recital_refunds WHERE household_id=?`, [h])).toEqual({ amount: 7500, reason_no: 3 });
  });
  it('「会員ではない」→ none・member_id 空', async () => {
    const { p } = await one('t-sd-c4', [['W1']], [], { matchStatus: 'pending' });
    expect(await staff.decideMemberMatch(p[0], { none: true }, '確かめた', N)).toMatchObject({ changed: false, presetClass: null, keptClass: null });
    expect(await core.getOne(`SELECT member_id, match_status FROM recital_people WHERE id=?`, [p[0]])).toEqual({ member_id: null, match_status: 'none' });
  });
  it('listMatchCandidates：カナが合い生年月日がちがう会員が候補に出る', async () => {
    const m = await seedMember({ fullName: '試験 四', kana: 'シケンヨン', birthday: '2014-01-01' });
    const { p } = await one('t-sd-c5', [['W1']], [], { lastKana: 'シケン', firstKana: 'ヨン', birthday: '2015-04-04', matchStatus: 'pending' });
    await preset('t-sd-c5', m, 'tshirt_only');
    const r = await staff.listMatchCandidates(p[0]);
    expect(r.candidates.map((c) => c.id)).toContain(m);
    expect(r.presets[m]).toBe('tshirt_only');
  });
  it('dryRun は書かない／無い会員は throw', async () => {
    const m = await seedMember({ fullName: '試験 五', kana: 'シケンゴ', birthday: '2015-04-05' });
    const { p } = await one('t-sd-c6', [['W1']], [], { lastKana: 'シケン', firstKana: 'ゴ', birthday: '2015-04-05', matchStatus: 'pending' });
    await preset('t-sd-c6', m, 'no_coop');
    expect(await staff.decideMemberMatch(p[0], { memberId: m }, '確かめた', N, { dryRun: true })).toMatchObject({ totalAfter: 19000 });
    expect(await core.getOne(`SELECT member_id, match_status, fee_class_override FROM recital_people WHERE id=?`, [p[0]])).toEqual({ member_id: null, match_status: 'pending', fee_class_override: null });
    await expect(staff.decideMemberMatch(p[0], { memberId: 99999999 }, '確かめた', N)).rejects.toThrow('no_member');
  });
});
