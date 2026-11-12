// BW6 発表会（段階1）の recitalMoneyDb.ts（お金の核）の試験（実 DB・試験用のファイル DB）。Task 9。
// 自分の event_key（t-money*）の行だけを見る。メールは 10 の仮のファイルなので mock する（このファイルは送らないが、念のため）。
import { describe, it, expect, vi } from 'vitest';
import { setupRecitalTestDb, seedRecitalTestEvent, seedHousehold } from './recitalTestSeed';

vi.mock('@/lib/recitalMail', () => ({ sendRecitalMail: vi.fn(async () => ({ status: 'sent', logId: 1 })), sendPaidMail: vi.fn(async () => ({ status: 'none' })) }));
vi.mock('@/lib/recitalMail.ts', () => ({ sendRecitalMail: vi.fn(async () => ({ status: 'sent', logId: 1 })), sendPaidMail: vi.fn(async () => ({ status: 'none' })) }));

await setupRecitalTestDb('money');
await seedRecitalTestEvent('t-money');
const core = await import('../db');
const money = await import('../recitalMoneyDb');

type PayExtra = Partial<Omit<import('../recitalMoneyDb').PaymentInput, 'householdId' | 'method' | 'amount'>>;
function pay(hid: number, amount: number, method: 'bank' | 'card' | 'cash' | 'adjust' = 'bank', extra: PayExtra = {}) {
  return core.withWriteTx((tx) =>
    money.insertPaymentTx(tx, { householdId: hid, method, amount, paidOn: '2026-12-21', source: 'bank_staff', ...extra }, 'TARO'),
  );
}

let bankRowSeq = 0;
/** recital_bank_rows に matched・in・transfer・chat の1行を足して id を返す（row_key は呼ぶたびに変える） */
async function bankRow(amount: number, eventKey = 't-money'): Promise<number> {
  bankRowSeq++;
  const r = await core.execute(
    `INSERT INTO recital_bank_rows (event_key, created_at, row_date, dir, amount, kind, row_key, source, state)
     VALUES (?, ?, '2026-12-21', 'in', ?, 'transfer', ?, 'chat', 'matched')`,
    [eventKey, new Date().toISOString(), amount, 't|' + bankRowSeq],
  );
  return Number(r.lastInsertRowid);
}

/** 生きている請求の行を void にして額 n の base を1行足す */
async function setTotal(hid: number, n: number): Promise<void> {
  const now = new Date().toISOString();
  await core.execute("UPDATE recital_charges SET status='void', void_reason='試し', voided_at=? WHERE household_id=? AND status='active'", [now, hid]);
  await core.execute(
    `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, status, created_at)
     VALUES ('t-money', ?, NULL, 'base', '', '出演料（本体）', 1, ?, ?, 'active', ?)`,
    [hid, n, n, now],
  );
}

describe('返す額の例（05 5-7 の12行）', () => {
  it.each([
    ['合同で1つへる（1人3作品・全部払った）', 35500, 35500, 32500, 3000],
    ['合同で1つへる（1人2作品・全部払った）', 32500, 32500, 26500, 6000],
    ['1人1作品のその作品がなくなる', 26500, 26500, 0, 26500],
    ['兄1・妹1で妹の作品がなくなり妹が出ない', 34500, 34500, 26500, 8000],
    ['兄2・妹1で同上', 37500, 37500, 32500, 5000],
    ['お支払いずみ 3,000 の世帯で、もう1つがスクールの都合でなくなる', 32500, 35500, 26500, 6000],
    ['1作品払って1つ足した（差額まだ）世帯で、足した作品がなくなる', 32500, 26500, 26500, 0],
    ['まだ払っていない2作品の世帯で1つがなくなる', 32500, 0, 26500, 0],
    ['別々に払った家族（1作品ずつ）をまとめる', 53000, 53000, 34500, 18500],
    ['同じ子の二重の申込を両方払った', 53000, 53000, 26500, 26500],
    ['払った1人1作品の1人目を「協力チケットなし」に直した', 26500, 26500, 19000, 7500],
  ])('%s', (_, totalBefore, paid, totalAfter, want) => {
    expect(money.refundForDecrease({ totalBefore, paid, totalAfter })).toBe(want);
  });
  it('26,500 の世帯が 32,500 を振り込んだ（人が当てた）→ 返す分 6,000（1番・もとの入金つき）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const r = await pay(hid, 32500);
    const ref = await core.getOne('SELECT amount, reason_no, source_payment_id, status FROM recital_refunds WHERE id=?', [r.refundId]);
    expect([Number(ref.amount), Number(ref.reason_no), Number(ref.source_payment_id), ref.status]).toEqual([6000, 1, r.paymentId, 'todo']);
    expect(r.after).toEqual({ total: 26500, paid: 26500, remaining: 0, overpaid: 0 });
  });
});

describe('お支払いずみの分と返す分のちがい（05 5-7 の5行）', () => {
  it('(1) 35,500 払ったあと家庭の都合で1作品へらした → 払った 35,500・合計 32,500・お支払いずみ 3,000', async () => {
    const hid = await seedHousehold('t-money', { total: 35500, cast: 'in' });
    await pay(hid, 35500, 'cash'); await setTotal(hid, 32500);
    expect((await money.readHouseholdMoney(hid)).m).toEqual({ total: 32500, paid: 35500, remaining: 0, overpaid: 3000 });
  });
  it('(2) 26,500 の世帯が 32,500 振り込んだ（当てたあと）→ 返す分 6,000・払った 26,500・お支払いずみ 0', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await pay(hid, 32500);
    const r = await money.readHouseholdMoney(hid);
    expect([r.m.paid, r.m.overpaid, r.refundTodo]).toEqual([26500, 0, 6000]);
  });
  it('(3) その世帯に 6,000 を返したあと → 入金 26,500・返す分 0・払った 26,500', async () => {
    // 「返金を記録」は後の計画。ここでは refunds を status='done' にし、入金に -6,000 の行を SQL で入れて同じ数字を確かめる
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const p = await pay(hid, 32500);
    await core.execute("UPDATE recital_refunds SET status='done' WHERE id=?", [p.refundId]);
    await core.execute("INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, created_at) VALUES ('t-money', ?, 'bank', -6000, '2026-12-28', 'manual', ?)", [hid, new Date().toISOString()]);
    const r = await money.readHouseholdMoney(hid);
    expect([r.m.paid, r.m.overpaid, r.refundTodo]).toEqual([26500, 0, 0]);
  });
  it('(4) 返す前に cancelRefund → 入金 32,500・払った 32,500・合計 26,500・お支払いずみ 6,000（K187）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const p = await pay(hid, 32500);
    await money.cancelRefund(p.refundId!, 'そのまま預かる（家庭と話した）', 'TARO');
    expect((await money.readHouseholdMoney(hid)).m).toEqual({ total: 26500, paid: 32500, remaining: 0, overpaid: 6000 });
  });
  it('(5) 35,500 払った世帯で1作品がスクールの都合でなくなった → 4番の返す分 3,000・払った 32,500・お支払いずみ 0', async () => {
    const hid = await seedHousehold('t-money', { total: 35500, cast: 'in' });
    await pay(hid, 35500, 'cash'); await setTotal(hid, 32500);
    await core.withWriteTx((tx) => money.createRefundTx(tx, { householdId: hid, amount: 3000, reasonNo: 4, reason: 'スクールの都合で作品がなくなった', createdBy: 'TARO' }));
    const r = await money.readHouseholdMoney(hid);
    expect([r.m.paid, r.m.overpaid, r.refundTodo]).toEqual([32500, 0, 3000]);
  });
});

describe('守り', () => {
  it('同じ台帳行×同じ世帯の生きているプラスは1つ', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const row = await bankRow(26500);
    await pay(hid, 13000, 'bank', { bankRowId: row });
    await expect(pay(hid, 13500, 'bank', { bankRowId: row })).rejects.toThrow('recital_money:live_exists');
  });
  it('1台帳行の合計は行の額まで（2つの世帯に分ける 26,500＋26,500 は通り、もう1円は通らない）', async () => {
    const a = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const b = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const c = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const row = await bankRow(53000);
    await pay(a, 26500, 'bank', { bankRowId: row });
    await pay(b, 26500, 'bank', { bankRowId: row });
    await expect(pay(c, 1, 'bank', { bankRowId: row })).rejects.toThrow('recital_money:row_over');
  });
  it('rejects bank row of another event', async () => {
    await seedRecitalTestEvent('t-money-other');
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await expect(pay(hid, 26500, 'bank', { bankRowId: await bankRow(26500, 't-money-other') })).rejects.toThrow('recital_money:bad_input');
  });
  it('払った額が0未満になる書き込みは通さず、行も増えない', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await expect(pay(hid, -1000, 'cash')).rejects.toThrow('recital_money:negative');
    expect(Number((await core.getOne('SELECT COUNT(*) n FROM recital_payments WHERE household_id=?', [hid])).n)).toBe(0);
  });
  it('出演なしの世帯に当てても返す分を作らない（K207）', async () => {
    const hid = await seedHousehold('t-money', { total: 0, cast: 'out' });
    expect((await pay(hid, 26500)).refundId).toBeNull();
  });
  it('振込で当たったら「振り込みました」の5列を閉じ、記録に前の日と金額（名義は残さない）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await core.execute("UPDATE recital_households SET bank_told_at='2026-12-21T01:00:00.000Z', bank_told_date='2026-12-21', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [hid]);
    const r = await pay(hid, 26500, 'bank');
    const h = await core.getOne('SELECT bank_told_at, bank_told_date, bank_told_name, bank_told_amount, bank_told_by FROM recital_households WHERE id=?', [hid]);
    expect(Object.values(h).every((v) => v === null)).toBe(true);
    const c = await core.getOne("SELECT before_json, after_json FROM recital_changes WHERE household_id=? AND action='payment_recorded' ORDER BY id DESC", [hid]);
    expect(JSON.parse(c.before_json).told).toEqual({ at: '2026-12-21T01:00:00.000Z', date: '2026-12-21', amount: 26500, by: 'family' });
    expect(JSON.parse(c.after_json).paymentId).toBe(r.paymentId);
    expect(String(c.before_json)).not.toContain('ヤマダ');
  });
  it('カードでは印を閉じない', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await core.execute("UPDATE recital_households SET bank_told_at='2026-12-21T01:00:00.000Z', bank_told_date='2026-12-21', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [hid]);
    await pay(hid, 26500, 'card', { source: 'stripe_webhook' });
    expect((await core.getOne('SELECT bank_told_amount a FROM recital_households WHERE id=?', [hid])).a).toBe(26500);
  });
  it('カードと振込の両方で払われたら、返す分は作ったもとの入金（あとから来た方）に結び「（カードの方を Stripe で返す）」（K200・2-25）', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await pay(hid, 26500, 'card', { source: 'stripe_webhook' });
    const bank = await pay(hid, 26500, 'bank', { bankRowId: await bankRow(26500) });
    const ref = await core.getOne('SELECT amount, source_payment_id, reason FROM recital_refunds WHERE id=?', [bank.refundId]);
    expect([Number(ref.amount), Number(ref.source_payment_id)]).toEqual([26500, bank.paymentId]);
    expect(ref.reason).toContain('（カードの方を Stripe で返す）');
    // 逆の順（振込が先・カードがあと）も、結ぶのはあとから来たカードの入金
    const hid2 = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await pay(hid2, 26500, 'bank', { bankRowId: await bankRow(26500) });
    const card2 = await pay(hid2, 26500, 'card', { source: 'stripe_webhook' });
    const ref2 = await core.getOne('SELECT source_payment_id, reason FROM recital_refunds WHERE id=?', [card2.refundId]);
    expect(Number(ref2.source_payment_id)).toBe(card2.paymentId);
    expect(ref2.reason).toContain('（カードの方を Stripe で返す）');
  });
  it('stripe_recheck で記録したあとに手で現金を記録 → 返す分の理由に「（二重の記録かもしれません）」', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await pay(hid, 26500, 'card', { source: 'stripe_recheck' });
    const r = await money.recordManualPayment(hid, { method: 'cash', amount: 26500, paidOn: '2026-12-21', memo: '' }, 'TARO');
    const ref = await core.getOne("SELECT reason FROM recital_refunds WHERE household_id=? AND status='todo'", [hid]);
    expect(ref.reason).toContain('（二重の記録かもしれません）');
    expect(r.after.overpaid).toBe(0);
  });
  it('recordManualPayment：調整はメモ必須・振込とカードは選べない・現金は記録して after を返す', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await expect(money.recordManualPayment(hid, { method: 'adjust', amount: 440, paidOn: '2026-12-21', memo: '' }, 'TARO')).rejects.toThrow('recital_money:bad_input');
    await expect(money.recordManualPayment(hid, { method: 'bank' as never, amount: 26500, paidOn: '2026-12-21', memo: 'x' }, 'TARO')).rejects.toThrow('recital_money:bad_input');
    await expect(money.recordManualPayment(hid, { method: 'cash', amount: -100, paidOn: '2026-12-21', memo: '' }, 'TARO')).rejects.toThrow('recital_money:bad_input');
    expect((await money.recordManualPayment(hid, { method: 'cash', amount: 26500, paidOn: '2026-12-21', memo: '' }, 'TARO')).after.remaining).toBe(0);
  });
  it('打ちまちがいの打ち消し：現金 26,500 → 調整 −26,500（メモ『打ちまちがい』）で払った額 0', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    await money.recordManualPayment(hid, { method: 'cash', amount: 26500, paidOn: '2026-12-21', memo: '' }, 'TARO');
    const r = await money.recordManualPayment(hid, { method: 'adjust', amount: -26500, paidOn: '2026-12-21', memo: '打ちまちがい' }, 'TARO');
    expect(r.after).toEqual({ total: 26500, paid: 0, remaining: 26500, overpaid: 0 });
    await expect(money.recordManualPayment(hid, { method: 'adjust', amount: -1, paidOn: '2026-12-21', memo: '打ちまちがい' }, 'TARO')).rejects.toThrow('recital_money:negative');
  });
  it('recordManualPayment と cancelRefund は書き込みのあと afterMoneyChanged(id,"payment") を呼ぶ', async () => {
    // afterMoneyChanged は同じファイルなので vi.spyOn(money, 'afterMoneyChanged') では捕まらない。中で呼ぶ所を内部の関数 notifyMoneyChanged にして、試験はその spy で見る
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const spy = vi.spyOn(money.__internal, 'notifyMoneyChanged');
    await money.recordManualPayment(hid, { method: 'cash', amount: 1000, paidOn: '2026-12-21', memo: '' }, 'TARO');
    expect(spy).toHaveBeenCalledWith(hid, 'payment');
    spy.mockClear();
    const p = await pay(hid, 32500);                       // 残り 25,500 をこえた 7,000 の返す分ができる
    await money.cancelRefund(p.refundId!, 'そのまま預かる', 'TARO');
    expect(spy).toHaveBeenCalledWith(hid, 'payment');
  });
  it('6番の返す分は「お支払いずみの分」まで（K217）', async () => {
    const hid = await seedHousehold('t-money', { total: 35500, cast: 'in' });
    await pay(hid, 35500, 'cash'); await setTotal(hid, 32500);   // 払った 35,500・合計 32,500・お支払いずみ 3,000
    await expect(core.withWriteTx((tx) => money.createRefundTx(tx, { householdId: hid, amount: 3001, reasonNo: 6, reason: '例外として返す', createdBy: 'TARO' }))).rejects.toThrow('recital_money:over_overpaid');
    expect(await core.withWriteTx((tx) => money.createRefundTx(tx, { householdId: hid, amount: 3000, reasonNo: 6, reason: '例外として返す', createdBy: 'TARO' }))).toBeGreaterThan(0);
  });
  it('cancelRefund は理由必須・todo の行だけ', async () => {
    const hid = await seedHousehold('t-money', { total: 26500, cast: 'in' });
    const p = await pay(hid, 32500);
    await expect(money.cancelRefund(p.refundId!, '', 'TARO')).rejects.toThrow('recital_money:bad_input');
    await money.cancelRefund(p.refundId!, 'そのまま預かる', 'TARO');
    await expect(money.cancelRefund(p.refundId!, 'もう1回', 'TARO')).rejects.toThrow('recital_money:bad_input');
  });
  it('readHouseholdMoney は見え方・返す分・印・払い方を返す', async () => {
    const hid = await seedHousehold('t-money', { total: 32500, cast: 'in', payMethod: 'bank' });
    await core.execute("UPDATE recital_households SET bank_told_at='2026-12-21T01:00:00.000Z', bank_told_date='2026-12-21', bank_told_name='4827 ヤマダ ハナコ', bank_told_amount=26500, bank_told_by='family' WHERE id=?", [hid]);
    expect(await money.readHouseholdMoney(hid)).toMatchObject({
      m: { total: 32500, paid: 0, remaining: 32500, overpaid: 0 }, view: 'tentative', refundTodo: 0,
      told: { date: '2026-12-21', amount: 26500, by: 'family' }, payMethod: 'bank',
    });
  });
});
