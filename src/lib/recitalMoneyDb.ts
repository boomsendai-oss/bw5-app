// BW6 発表会（段階1）のお金の核（Task 9）：入金の行を書く核（守り全部）・返す分（しくみの1番・取り消す）・
// 世帯のお金を読む・手で入金を記録・afterMoneyChanged。
// 決まりの正本は設計書 03 3-4 payments・3-16、05 5-6・5-7、決まり K187・K199・K200・K202・K206・K207・K216・K217。
// DB は src/lib/db.ts 経由だけ。名前と型の正本は .superpowers/sdd/2026-11-12-bw6-recital-stage1/ref/split.md ③。
// 記録の日時は UTC ISO（nowUtcIso）。メールはここでは送らない（呼ぶ側が sendPaidMail を呼ぶ）。
import type { Transaction } from '@libsql/client';
import { getOne, withWriteTx } from '@/lib/db';
import { isIsoDate, nowUtcIso } from '@/lib/dateJst';
import type { HouseholdView, MoneySummary } from '@/lib/recital';
import { logChangeTx, readMoneyViewTx } from '@/lib/recitalDb';

// ---------- 型（split.md ③） ----------

export type HouseholdMoney = {
  m: MoneySummary; view: HouseholdView; refundTodo: number;
  told: { at: string; date: string; name: string | null; amount: number; by: 'family' | 'staff' } | null;
  payMethod: string | null;
};

export type PaymentInput = {
  householdId: number; method: 'bank' | 'card' | 'cash' | 'adjust'; amount: number; paidOn: string;
  source: 'manual' | 'stripe_webhook' | 'stripe_recheck' | 'bank_auto' | 'bank_staff';
  confirmedBy?: string | null; memo?: string | null; bankRowId?: number | null; bankDate?: string | null; bankDesc?: string | null;
  payerNameRaw?: string | null; stripeEventId?: string | null; stripeSessionId?: string | null; stripePiId?: string | null;
};

const PAYMENT_METHODS: readonly string[] = ['bank', 'card', 'cash', 'adjust'];
const PAYMENT_SOURCES: readonly string[] = ['manual', 'stripe_webhook', 'stripe_recheck', 'bank_auto', 'bank_staff'];
const REFUND_REASON_NOS: readonly number[] = [1, 2, 3, 4, 6];

const REASON_OVER_REMAINING = '入金を記録して残りをこえた';
const NOTE_CARD_AND_BANK = '（カードの方を Stripe で返す）';
const NOTE_MAYBE_DOUBLE = '（二重の記録かもしれません）';
/** 世帯をまとめる時の「移す」の調整の行に書くメモ（設計書 03 3-4 method）。二重の記録の判定から外す */
const MEMO_MOVED = '移した';

function fail(code: 'bad_input' | 'live_exists' | 'row_over' | 'negative' | 'over_overpaid'): never {
  throw new Error(`recital_money:${code}`);
}

function isNonZeroInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n !== 0;
}

function isBlank(s: unknown): boolean {
  return typeof s !== 'string' || s.trim() === '';
}

function optText(s: string | null | undefined): string | null {
  return s == null || s.trim() === '' ? null : s;
}

// ---------- 純関数 ----------

/**
 * 「二重の記録かもしれません」の条件の正本（9 の返す分の理由と 19 の世帯の画面が使う）。
 * source=manual でメモが「移した」でないプラスの行と、source が stripe_webhook か stripe_recheck の行が両方ある時 true。
 */
export function maybeDoubleRecord(payments: { source: string; memo: string | null; amount: number }[]): boolean {
  const manual = payments.some((p) => p.source === 'manual' && p.amount > 0 && (p.memo ?? '').trim() !== MEMO_MOVED);
  const stripe = payments.some((p) => p.source === 'stripe_webhook' || p.source === 'stripe_recheck');
  return manual && stripe;
}

/** 合計が下がった時に返す額：max(0, min(前の合計, 払った額) − あとの合計)（05 5-7） */
export function refundForDecrease(x: { totalBefore: number; paid: number; totalAfter: number }): number {
  return Math.max(0, Math.min(x.totalBefore, x.paid) - x.totalAfter);
}

// ---------- 世帯のお金を読む ----------

export async function readHouseholdMoneyTx(tx: Transaction, householdId: number): Promise<HouseholdMoney> {
  return readHouseholdMoneyCore(tx, householdId);
}

export async function readHouseholdMoney(householdId: number): Promise<HouseholdMoney> {
  return readHouseholdMoneyCore(null, householdId);
}

async function readHouseholdMoneyCore(tx: Transaction | null, householdId: number): Promise<HouseholdMoney> {
  const h = await readHouseholdRow(tx, householdId);
  if (!h) fail('bad_input');
  // m・view・refundTodo の計算は Task 6 の readMoneyViewTx が正本（ここに同じ計算を書かない）
  const mv = await readMoneyViewTx(tx, householdId);
  const told = h.bank_told_at == null
    ? null
    : {
        at: String(h.bank_told_at),
        date: String(h.bank_told_date ?? ''),
        name: h.bank_told_name == null ? null : String(h.bank_told_name),
        amount: Number(h.bank_told_amount ?? 0),
        by: String(h.bank_told_by) as 'family' | 'staff',
      };
  return { m: mv.m, view: mv.view, refundTodo: mv.refundTodo, told, payMethod: h.pay_method == null ? null : String(h.pay_method) };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB の行は動的キー */
async function readHouseholdRow(tx: Transaction | null, householdId: number): Promise<any | null> {
  const sql = `SELECT id, event_key, pay_method, bank_told_at, bank_told_date, bank_told_name, bank_told_amount, bank_told_by
               FROM recital_households WHERE id = ?`;
  if (!Number.isInteger(householdId)) return null;
  if (tx) return ((await tx.execute({ sql, args: [householdId] })).rows[0] as any) ?? null;
  return (await getOne(sql, [householdId])) ?? null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function sumOf(tx: Transaction, sql: string, args: (string | number)[]): Promise<number> {
  const r = await tx.execute({ sql, args });
  return Number(r.rows[0]?.n ?? 0);
}

// ---------- 入金の行を書く核 ----------

/**
 * 入金の行を1つ書く核（全部の入金がここを通る。05 5-6・5-7、K199・K200・K202・K207）。
 * 順：形 → 前のお金 → 台帳の行の守り → 0未満の守り → 入金の行 → 返す分1番 → 「振り込みました」の印を閉じる → 記録 → あとのお金。
 */
export async function insertPaymentTx(
  tx: Transaction,
  p: PaymentInput,
  actor: string,
): Promise<{ paymentId: number; before: MoneySummary; after: MoneySummary; refundId: number | null }> {
  // 1. 形
  if (!isNonZeroInt(p.amount)) fail('bad_input');
  if (!PAYMENT_METHODS.includes(p.method) || !PAYMENT_SOURCES.includes(p.source)) fail('bad_input');
  if (!isIsoDate(p.paidOn)) fail('bad_input');
  if (isBlank(actor)) fail('bad_input');
  if (p.bankRowId != null && !Number.isInteger(p.bankRowId)) fail('bad_input');
  const h = await readHouseholdRow(tx, p.householdId);
  if (!h) fail('bad_input');
  const eventKey = String(h.event_key);

  // 2. 前のお金
  const before = await readHouseholdMoneyTx(tx, p.householdId);

  // 3. 台帳の行の守り（K200）
  if (p.bankRowId != null) {
    const row = await tx.execute({ sql: 'SELECT event_key, amount FROM recital_bank_rows WHERE id = ?', args: [p.bankRowId] });
    const r = row.rows[0];
    if (!r || String(r.event_key) !== eventKey) fail('bad_input');
    const sameHousehold = await sumOf(
      tx,
      'SELECT COALESCE(SUM(amount), 0) AS n FROM recital_payments WHERE bank_transaction_id = ? AND household_id = ?',
      [p.bankRowId, p.householdId],
    );
    if (sameHousehold > 0 && p.amount > 0) fail('live_exists');
    const rowTotal = await sumOf(tx, 'SELECT COALESCE(SUM(amount), 0) AS n FROM recital_payments WHERE bank_transaction_id = ?', [p.bankRowId]);
    if (rowTotal + p.amount > Number(r.amount)) fail('row_over');
  }

  // 4. 払った額（入金の和＋今の額−返す分 todo）が0未満にならない
  if (before.m.paid + p.amount < 0) fail('negative');

  // 5. 入金の行
  const ins = await tx.execute({
    sql: `INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, bank_transaction_id, bank_date, bank_desc,
          payer_name_raw, stripe_event_id, stripe_session_id, stripe_pi_id, confirmed_by, memo, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      eventKey, p.householdId, p.method, p.amount, p.paidOn, p.source, p.bankRowId ?? null, optText(p.bankDate), optText(p.bankDesc),
      optText(p.payerNameRaw), optText(p.stripeEventId), optText(p.stripeSessionId), optText(p.stripePiId), optText(p.confirmedBy),
      optText(p.memo), nowUtcIso(),
    ],
  });
  const paymentId = Number(ins.lastInsertRowid);

  // 6. 返す分1番（出演なしの世帯では作らない K207。結ぶ先はいつも今の入金 K200）
  let refundId: number | null = null;
  if (p.amount > 0 && p.method !== 'adjust' && before.view !== 'none' && p.amount > before.m.remaining) {
    const rows = await tx.execute({ sql: 'SELECT method, source, memo, amount FROM recital_payments WHERE household_id = ?', args: [p.householdId] });
    const pays = rows.rows.map((x) => ({
      method: String(x.method), source: String(x.source), memo: x.memo == null ? null : String(x.memo), amount: Number(x.amount),
    }));
    const liveOf = (method: string) => pays.filter((x) => x.method === method).reduce((a, x) => a + x.amount, 0) > 0;
    let reason = REASON_OVER_REMAINING;
    if (liveOf('card') && liveOf('bank')) reason += NOTE_CARD_AND_BANK;
    if (maybeDoubleRecord(pays)) reason += NOTE_MAYBE_DOUBLE;
    refundId = await createRefundTx(tx, {
      householdId: p.householdId, amount: p.amount - before.m.remaining, reasonNo: 1, reason, sourcePaymentId: paymentId, createdBy: 'system',
    });
  }

  // 7. 振込のプラスで当たったら「振り込みました」の5列を閉じる（K202）
  let closedTold: { at: string; date: string; amount: number; by: 'family' | 'staff' } | null = null;
  if (p.method === 'bank' && p.amount > 0) {
    if (before.told) closedTold = { at: before.told.at, date: before.told.date, amount: before.told.amount, by: before.told.by };
    await tx.execute({
      sql: `UPDATE recital_households SET bank_told_at = NULL, bank_told_date = NULL, bank_told_name = NULL, bank_told_amount = NULL, bank_told_by = NULL
            WHERE id = ?`,
      args: [p.householdId],
    });
  }

  // 8. 記録（28 の取り消しはこれだけを読む。before.told はこの入金が閉じた印。名義は残さない R-18）
  await logChangeTx(tx, {
    eventKey, householdId: p.householdId, action: 'payment_recorded', actor,
    before: { told: closedTold },
    after: { paymentId, method: p.method, amount: p.amount, source: p.source, bankRowId: p.bankRowId ?? null, refundId },
  });

  // 9. あとのお金
  const after = (await readHouseholdMoneyTx(tx, p.householdId)).m;
  return { paymentId, before: before.m, after, refundId };
}

// ---------- 返す分 ----------

/** 返す分の行を1つ作る（status=todo）。6番は「お支払いずみの分」まで（K217）。 */
export async function createRefundTx(
  tx: Transaction,
  r: { householdId: number; amount: number; reasonNo: 1 | 2 | 3 | 4 | 6; reason: string; sourcePaymentId?: number | null; waitingReply?: boolean; createdBy: string },
): Promise<number> {
  if (!Number.isInteger(r.amount) || r.amount <= 0) fail('bad_input');
  if (!REFUND_REASON_NOS.includes(r.reasonNo)) fail('bad_input');
  if (isBlank(r.reason) || isBlank(r.createdBy)) fail('bad_input');
  if (r.sourcePaymentId != null && !Number.isInteger(r.sourcePaymentId)) fail('bad_input');
  const h = await readHouseholdRow(tx, r.householdId);
  if (!h) fail('bad_input');
  const eventKey = String(h.event_key);
  if (r.reasonNo === 6) {
    const cur = await readHouseholdMoneyTx(tx, r.householdId);
    if (r.amount > cur.m.overpaid) fail('over_overpaid');
  }
  const waitingReply = r.waitingReply ? 1 : 0;
  const sourcePaymentId = r.sourcePaymentId ?? null;
  const ins = await tx.execute({
    sql: `INSERT INTO recital_refunds (event_key, household_id, amount, reason_no, reason, waiting_reply, status, source_payment_id, created_at, created_by)
          VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?)`,
    args: [eventKey, r.householdId, r.amount, r.reasonNo, r.reason, waitingReply, sourcePaymentId, nowUtcIso(), r.createdBy],
  });
  const refundId = Number(ins.lastInsertRowid);
  await logChangeTx(tx, {
    eventKey, householdId: r.householdId, action: 'refund_created', actor: r.createdBy, reason: r.reason, isException: r.reasonNo === 6,
    after: { refundId, amount: r.amount, reasonNo: r.reasonNo, sourcePaymentId, waitingReply: waitingReply === 1 },
  });
  return refundId;
}

/** 返す前の返す分を取り消す（K187）。理由必須・todo の行だけ。書き込みのあと afterMoneyChanged(id, 'payment')。 */
export async function cancelRefund(refundId: number, reason: string, staffName: string): Promise<void> {
  if (!Number.isInteger(refundId) || isBlank(reason) || isBlank(staffName)) fail('bad_input');
  const householdId = await withWriteTx(async (tx) => {
    const cur = await tx.execute({ sql: 'SELECT event_key, household_id, amount, reason_no, status FROM recital_refunds WHERE id = ?', args: [refundId] });
    const row = cur.rows[0];
    if (!row || String(row.status) !== 'todo') fail('bad_input');
    const hid = Number(row.household_id);
    await tx.execute({ sql: "UPDATE recital_refunds SET status = 'cancelled' WHERE id = ? AND status = 'todo'", args: [refundId] });
    await logChangeTx(tx, {
      eventKey: String(row.event_key), householdId: hid, action: 'refund_cancelled', actor: staffName, reason,
      before: { refundId, status: 'todo', amount: Number(row.amount), reasonNo: Number(row.reason_no) },
      after: { refundId, status: 'cancelled' },
    });
    return hid;
  });
  await notifyAfterWrite(householdId);
}

// ---------- 手で入金を記録 ----------

/**
 * スタッフの「手で入金を記録」（現金／調整だけ。振込とカードは選べない）。調整はメモ必須、マイナスは打ちまちがいの打ち消し。
 * 書き込みのあと afterMoneyChanged(id, 'payment') を中で呼ぶ。メールは送らない（呼ぶ側が sendPaidMail を呼ぶ）。
 */
export async function recordManualPayment(
  householdId: number,
  x: { method: 'cash' | 'adjust'; amount: number; paidOn: string; memo: string },
  staffName: string,
): Promise<{ paymentId: number; after: MoneySummary }> {
  if (x.method !== 'cash' && x.method !== 'adjust') fail('bad_input');
  if (x.method === 'cash' && !(Number.isInteger(x.amount) && x.amount >= 1)) fail('bad_input');
  if (x.method === 'adjust' && (!isNonZeroInt(x.amount) || isBlank(x.memo))) fail('bad_input');
  if (isBlank(staffName)) fail('bad_input');
  const r = await withWriteTx((tx) =>
    insertPaymentTx(
      tx,
      { householdId, method: x.method, amount: x.amount, paidOn: x.paidOn, source: 'manual', confirmedBy: staffName, memo: x.memo ?? null },
      staffName,
    ),
  );
  await notifyAfterWrite(householdId);
  return { paymentId: r.paymentId, after: r.after };
}

// ---------- お金が変わったあと ----------

/** お金が変わったあとの仕事（中身は 21 がカードの作り直し、23 がご案内の出し直しを足す）。書き込み（withWriteTx）の中から呼ばない。 */
export async function afterMoneyChanged(householdId: number, cause: 'total' | 'payment'): Promise<void> {
  void householdId;
  void cause;
}

/** 同じファイルの中から afterMoneyChanged を呼ぶ時の通り道（試験の spy 用。ほかのファイルからは使わない） */
export const __internal = {
  notifyMoneyChanged: (householdId: number, cause: 'total' | 'payment'): Promise<void> => afterMoneyChanged(householdId, cause),
};

/** 書き込みはもう成り立っているので、あとの仕事の失敗はログだけにして呼んだ操作は止めない（Task 8 と同じ扱い） */
async function notifyAfterWrite(householdId: number): Promise<void> {
  try {
    await __internal.notifyMoneyChanged(householdId, 'payment');
  } catch (e) {
    console.error(`[recital] afterMoneyChanged に失敗しました household=${householdId}`, e instanceof Error ? e.message : String(e));
  }
}
