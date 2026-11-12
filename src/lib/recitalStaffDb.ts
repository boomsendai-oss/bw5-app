// BW6 発表会（段階1）のスタッフのお金の操作（Task 20）：特別な料金ボタン（種類を選ぶ）・そのほかの金額の直し（adjust）・
// 世帯をまとめる・会員との照合を決める。決まりの正本は設計書 05 5-1・5-2・5-7・5-8、決まり K217・K223・K226・K227・K228。
// 特別な料金の種類は人の fee_class_override だけが持つ。印を書く道は3つだけ（申込のときの自動／スタッフが会員と結んだ時（印が空のとき）／このボタン）。
// 金額はスタッフに打たせない（種類を選ぶ → 請求を作り直す）。adjust は3つの種類の外の額だけ。
// dryRun は同じ書き込みを withWriteTx の中で全部やってから DryRunDone を投げて巻き戻し、結果だけ返す（押す前の「今の合計 → 直したあと」）。
// tx の中では外の API（メール・Stripe）を呼ばない。tx の外の仕事は dryRun でない時だけ。名前・カナ・生年月日・名義はログと記録に出さない。
import type { Transaction } from '@libsql/client';
import { getAll, getOne, withWriteTx } from '@/lib/db';
import { nowUtcIso, todayJst } from '@/lib/dateJst';
import { RECITAL_STAFF_NAMES, parseRecitalSettings, type FeeClass } from '@/lib/recital';
import { loadMembersLite, logChangeTx } from '@/lib/recitalDb';
import { recomputeChargesTx } from '@/lib/recitalEntryDb';
import { sendRecitalMail } from '@/lib/recitalMail';
import { matchMember, type MemberLite } from '@/lib/recitalMatch';
import { afterMoneyChanged, createRefundTx, readHouseholdMoneyTx, refundForDecrease } from '@/lib/recitalMoneyDb';
import { expireOpenCheckout } from '@/lib/recitalPayDb';

// ---------- 型（Task 20 の Produces） ----------

export type FeeChangePreview = { changed: boolean; totalBefore: number; totalAfter: number; refund: number; extra: number; adjustActive: number };
export type MergeResult =
  | { ok: true; totalBefore: number; totalAfter: number; moved: number; refund: number }
  | { ok: false; code: 'same' | 'not_active' | 'other_event' | 'has_adjust' | 'has_refund_todo' | 'bad_pair' };

type PresetClass = Exclude<FeeClass, null>;

const FEE_CLASSES: readonly string[] = ['free', 'no_coop', 'tshirt_only'];
const REASON_FEE_CLASS = '払ったあとに、スタッフが特別な料金の種類を直した';
const REASON_MERGED = '世帯をまとめた';
const MEMO_MOVED = '移した';
const WITHDRAW_SAME_PERSON = '同じ人の二重（世帯をまとめた）';
const ADJUST_LABEL = '手の調整';

// ---------- 小さな道具 ----------

/** dryRun の印。計算が終わったら投げて巻き戻し、外で返り値にする（このファイルの中だけ） */
class DryRunDone<T> extends Error {
  constructor(readonly result: T) { super('recital_staff:dry_run'); }
}
/** 書き込みの中で見つけた、返り値で知らせる失敗（投げて巻き戻す） */
class CodeFail<C extends string> extends Error {
  constructor(readonly code: C) { super(`recital_staff:${code}`); }
}

function fail(code: string): never {
  throw new Error(`recital_staff:${code}`);
}

const isBlank = (s: unknown) => typeof s !== 'string' || s.trim() === '';
const isId = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

function checkStaff(staffName: string): void {
  if (typeof staffName !== 'string' || !RECITAL_STAFF_NAMES.includes(staffName)) fail('staff_name');
}

function isFeeClass(v: unknown): v is FeeClass {
  return v === null || (typeof v === 'string' && FEE_CLASSES.includes(v));
}

function toFeeClass(v: unknown): FeeClass {
  return typeof v === 'string' && FEE_CLASSES.includes(v) ? (v as PresetClass) : null;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- DB の行は動的キー */
const rowsOf = async (tx: Transaction, sql: string, args: (string | number | null)[]): Promise<any[]> => (await tx.execute({ sql, args })).rows as any[];
/* eslint-enable @typescript-eslint/no-explicit-any */

/** 1回の withWriteTx で fn を通す。dryRun なら結果を作ってから巻き戻し、結果だけ返す */
async function runTx<T>(dryRun: boolean, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  try {
    return await withWriteTx(async (tx) => {
      const r = await fn(tx);
      if (dryRun) throw new DryRunDone(r);
      return r;
    });
  } catch (e) {
    if (e instanceof DryRunDone) return e.result as T;
    throw e;
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 合計が変わったあとの仕事（書き込みはもう成り立っているので、失敗はログだけ）。開いている支払いを先に合わせてから、変更の控え */
async function afterTotalChanged(householdId: number): Promise<void> {
  try {
    await afterMoneyChanged(householdId, 'total');
  } catch (e) {
    console.error(`[recital] afterMoneyChanged に失敗しました household=${householdId}`, errText(e));
  }
  await sendChangeMail(householdId);
}

async function sendChangeMail(householdId: number): Promise<void> {
  try {
    await sendRecitalMail({ kind: 'change', householdId });
  } catch (e) {
    console.error(`[recital] 変更の控えのメールを送れませんでした household=${householdId}`, errText(e));
  }
}

/** 生きている adjust の行の和 */
async function adjustActiveTx(tx: Transaction, householdId: number): Promise<number> {
  const [r] = await rowsOf(tx, "SELECT COALESCE(SUM(amount), 0) AS n FROM recital_charges WHERE household_id = ? AND item_code = 'adjust' AND status = 'active'", [householdId]);
  return Number(r?.n ?? 0);
}

/** 生きている請求の行の和（0未満なら0。8 の recomputeChargesTx と同じ数え方） */
async function chargeTotalTx(tx: Transaction, householdId: number): Promise<number> {
  const [r] = await rowsOf(tx, "SELECT COALESCE(SUM(amount), 0) AS n FROM recital_charges WHERE household_id = ? AND status = 'active'", [householdId]);
  return Math.max(0, Number(r?.n ?? 0));
}

type PersonCtx = { id: number; householdId: number; eventKey: string; feeClass: FeeClass; memberId: number | null; matchStatus: string | null };

/** 人と世帯がどちらも active なら読む。ちがえば throw（not_active） */
async function readActivePersonTx(tx: Transaction, personId: number): Promise<PersonCtx> {
  const [p] = await rowsOf(
    tx,
    `SELECT p.id, p.household_id, p.event_key, p.status, p.fee_class_override, p.member_id, p.match_status, h.status AS h_status
     FROM recital_people p JOIN recital_households h ON h.id = p.household_id WHERE p.id = ?`,
    [personId],
  );
  if (!p) fail('no_person');
  if (String(p.status) !== 'active' || String(p.h_status) !== 'active') fail('not_active');
  return {
    id: Number(p.id), householdId: Number(p.household_id), eventKey: String(p.event_key), feeClass: toFeeClass(p.fee_class_override),
    memberId: p.member_id == null ? null : Number(p.member_id), matchStatus: p.match_status == null ? null : String(p.match_status),
  };
}

/**
 * 特別な料金の印を書いて作り直す中身（setFeeClass と decideMemberMatch が共有する。2つ書かない）。
 * 印 → 請求の作り直し（8）→ 返す分3番（払ったあとに下がった分。式は 9 の refundForDecrease）→ fee_class_set。
 */
async function applyFeeClassTx(tx: Transaction, p: PersonCtx, next: FeeClass, reason: string, staffName: string): Promise<Omit<FeeChangePreview, 'adjustActive'>> {
  const before = await readHouseholdMoneyTx(tx, p.householdId);
  await tx.execute({ sql: 'UPDATE recital_people SET fee_class_override = ? WHERE id = ?', args: [next, p.id] });
  await recomputeChargesTx(tx, p.householdId, staffName);
  const after = await readHouseholdMoneyTx(tx, p.householdId);
  const refund = refundForDecrease({ totalBefore: before.m.total, paid: before.m.paid, totalAfter: after.m.total });
  if (refund > 0) {
    await createRefundTx(tx, { householdId: p.householdId, amount: refund, reasonNo: 3, reason: REASON_FEE_CLASS, createdBy: 'system' });
  }
  const extra = Math.max(0, after.m.remaining - before.m.remaining);
  await logChangeTx(tx, {
    eventKey: p.eventKey, householdId: p.householdId, personId: p.id, action: 'fee_class_set',
    before: { feeClass: p.feeClass }, after: { feeClass: next }, reason, actor: staffName, isException: false,
  });
  return { changed: true, totalBefore: before.m.total, totalAfter: after.m.total, refund, extra };
}

/** 変えなかった時の確かめの数（合計は今の値） */
async function unchangedTx(tx: Transaction, householdId: number): Promise<Omit<FeeChangePreview, 'adjustActive'>> {
  const cur = await readHouseholdMoneyTx(tx, householdId);
  return { changed: false, totalBefore: cur.m.total, totalAfter: cur.m.total, refund: 0, extra: 0 };
}

// ---------- 特別な料金ボタン ----------

/**
 * 人の特別な料金の種類を直す（ふつう＝null／協力チケットなし／Tシャツ代だけ／参加費なし）。理由必須。
 * 今の印と同じなら何も書かずに changed:false。合計が変わったら tx の外で afterMoneyChanged と変更の控え。
 */
export async function setFeeClass(
  personId: number, feeClass: FeeClass, reason: string, staffName: string, opts?: { dryRun?: boolean },
): Promise<FeeChangePreview> {
  checkStaff(staffName);
  if (!isFeeClass(feeClass)) fail('fee_class');
  if (isBlank(reason)) fail('reason');
  if (!isId(personId)) fail('no_person');
  const dryRun = opts?.dryRun === true;
  const r = await runTx(dryRun, async (tx) => {
    const p = await readActivePersonTx(tx, personId);
    const base = p.feeClass === feeClass ? await unchangedTx(tx, p.householdId) : await applyFeeClassTx(tx, p, feeClass, reason.trim(), staffName);
    return { householdId: p.householdId, preview: { ...base, adjustActive: await adjustActiveTx(tx, p.householdId) } };
  });
  if (!dryRun && r.preview.totalAfter !== r.preview.totalBefore) await afterTotalChanged(r.householdId);
  return r.preview;
}

// ---------- そのほかの金額の直し（adjust。K228） ----------

/** adjust の前後で合計がちがえば total_changed（10 の変更の控えと 27 は total_changed だけを読む） */
async function logTotalChangedTx(tx: Transaction, eventKey: string, householdId: number, before: number, after: number, actor: string): Promise<void> {
  if (before === after) return;
  await logChangeTx(tx, { eventKey, householdId, action: 'total_changed', actor, before: { total: before }, after: { total: after } });
}

/**
 * 3つの種類の外の額を足す・引く（手の調整の行）。金額は1以上の整数・理由必須（ちがえば invalid）。
 * 下げる時、今の合計をこえて下げられない（over_total）。返す分は作らない（K217。多く払った分は 6番の手で）。
 */
export async function addAdjustCharge(
  householdId: number,
  x: { direction: 'down' | 'up'; amount: number; reason: string },
  staffName: string,
  opts?: { dryRun?: boolean },
): Promise<{ ok: true; totalBefore: number; totalAfter: number } | { ok: false; code: 'over_total' | 'invalid' }> {
  checkStaff(staffName);
  if (!isId(householdId) || !x || (x.direction !== 'down' && x.direction !== 'up')) return { ok: false, code: 'invalid' };
  if (!(Number.isInteger(x.amount) && x.amount >= 1) || isBlank(x.reason)) return { ok: false, code: 'invalid' };
  const dryRun = opts?.dryRun === true;
  const reason = x.reason.trim();
  const amount = x.direction === 'down' ? -x.amount : x.amount;
  let r: { totalBefore: number; totalAfter: number };
  try {
    r = await runTx(dryRun, async (tx) => {
      const [h] = await rowsOf(tx, 'SELECT event_key, status FROM recital_households WHERE id = ?', [householdId]);
      if (!h || String(h.status) !== 'active') throw new CodeFail('invalid');
      const eventKey = String(h.event_key);
      const totalBefore = await chargeTotalTx(tx, householdId);
      if (x.direction === 'down' && x.amount > totalBefore) throw new CodeFail('over_total');
      const settings = parseRecitalSettings(
        (await rowsOf(tx, 'SELECT key, value FROM recital_settings WHERE event_key = ?', [eventKey])).map((s) => ({ key: String(s.key), value: String(s.value ?? '') })),
      );
      const ins = await tx.execute({
        sql: `INSERT INTO recital_charges (event_key, household_id, person_id, item_code, ref, label, qty, unit_amount, amount, due_on, status, created_at)
              VALUES (?, ?, NULL, 'adjust', '', ?, 1, ?, ?, ?, 'active', ?)`,
        args: [eventKey, householdId, ADJUST_LABEL, amount, amount, settings.pay_due, nowUtcIso()],
      });
      await logChangeTx(tx, {
        eventKey, householdId, action: 'adjust_add', actor: staffName, reason, isException: true,
        after: { chargeId: Number(ins.lastInsertRowid), amount },
      });
      const totalAfter = await chargeTotalTx(tx, householdId);
      await logTotalChangedTx(tx, eventKey, householdId, totalBefore, totalAfter, staffName);
      return { totalBefore, totalAfter };
    });
  } catch (e) {
    if (e instanceof CodeFail) return { ok: false, code: e.code as 'over_total' | 'invalid' };
    throw e;
  }
  if (!dryRun && r.totalAfter !== r.totalBefore) await afterTotalChanged(householdId);
  return { ok: true, totalBefore: r.totalBefore, totalAfter: r.totalAfter };
}

/** 手の調整の行を取り消す（item_code='adjust' で active の行だけ。理由必須）。合計が変われば total_changed も書く */
export async function voidAdjustCharge(chargeId: number, reason: string, staffName: string): Promise<{ ok: boolean }> {
  checkStaff(staffName);
  if (!isId(chargeId) || isBlank(reason)) return { ok: false };
  let r: { householdId: number; totalBefore: number; totalAfter: number };
  try {
    r = await withWriteTx(async (tx) => {
      const [c] = await rowsOf(
        tx,
        `SELECT c.event_key, c.household_id, c.amount, c.item_code, c.status, h.status AS h_status
         FROM recital_charges c JOIN recital_households h ON h.id = c.household_id WHERE c.id = ?`,
        [chargeId],
      );
      if (!c || String(c.item_code) !== 'adjust' || String(c.status) !== 'active' || String(c.h_status) !== 'active') throw new CodeFail('invalid');
      const eventKey = String(c.event_key);
      const householdId = Number(c.household_id);
      const totalBefore = await chargeTotalTx(tx, householdId);
      await tx.execute({
        sql: "UPDATE recital_charges SET status = 'void', void_reason = ?, voided_at = ? WHERE id = ? AND status = 'active'",
        args: [reason.trim(), nowUtcIso(), chargeId],
      });
      await logChangeTx(tx, {
        eventKey, householdId, action: 'adjust_void', actor: staffName, reason: reason.trim(), isException: true,
        before: { chargeId, amount: Number(c.amount), status: 'active' }, after: { chargeId, status: 'void' },
      });
      const totalAfter = await chargeTotalTx(tx, householdId);
      await logTotalChangedTx(tx, eventKey, householdId, totalBefore, totalAfter, staffName);
      return { householdId, totalBefore, totalAfter };
    });
  } catch (e) {
    if (e instanceof CodeFail) return { ok: false };
    throw e;
  }
  if (r.totalAfter !== r.totalBefore) await afterTotalChanged(r.householdId);
  return { ok: true };
}

// ---------- 世帯をまとめる（5-2・5-7） ----------

type MergeFailCode = Extract<MergeResult, { ok: false }>['code'];

/**
 * from の世帯を into にまとめる。人を移し、請求を両方作り直し、入金は「移した」調整の2行で移す（insertPaymentTx は通さない：
 * 1番の返す分を作る働きがあるため。まとめる時の返す分は2番でここで作る）。event_ledger には出さない。整理番号は両方そのまま。
 * samePeople は同じ人の二重（drop を withdrawn にし、その人の in・maybe の出演を out）。
 */
export async function mergeHouseholds(
  fromId: number,
  intoId: number,
  x: { reason: string; samePeople: { dropPersonId: number; keepPersonId: number }[] },
  staffName: string,
  opts?: { dryRun?: boolean },
): Promise<MergeResult> {
  checkStaff(staffName);
  if (!x || isBlank(x.reason)) fail('reason');
  if (!isId(fromId) || !isId(intoId)) return { ok: false, code: 'not_active' };
  if (fromId === intoId) return { ok: false, code: 'same' };
  const pairs = Array.isArray(x.samePeople) ? x.samePeople : null;
  if (!pairs || pairs.some((s) => !s || !isId(s.dropPersonId) || !isId(s.keepPersonId))) return { ok: false, code: 'bad_pair' };
  const reason = x.reason.trim();
  const dryRun = opts?.dryRun === true;

  let out: Extract<MergeResult, { ok: true }>;
  try {
    out = await runTx(dryRun, async (tx) => {
      // 1. 両方の世帯
      const cols = 'id, event_key, status, bank_told_at, bank_told_date, bank_told_name, bank_told_amount, bank_told_by';
      const [hf] = await rowsOf(tx, `SELECT ${cols} FROM recital_households WHERE id = ?`, [fromId]);
      const [hi] = await rowsOf(tx, `SELECT ${cols} FROM recital_households WHERE id = ?`, [intoId]);
      if (!hf || !hi || String(hf.status) !== 'active' || String(hi.status) !== 'active') throw new CodeFail<MergeFailCode>('not_active');
      if (String(hf.event_key) !== String(hi.event_key)) throw new CodeFail<MergeFailCode>('other_event');
      const eventKey = String(hi.event_key);

      // 2. 前のお金と、先に片づけてもらう物
      const bf = await readHouseholdMoneyTx(tx, fromId);
      const bi = await readHouseholdMoneyTx(tx, intoId);
      if ((await adjustActiveCountTx(tx, fromId)) > 0) throw new CodeFail<MergeFailCode>('has_adjust');
      if (bf.refundTodo > 0) throw new CodeFail<MergeFailCode>('has_refund_todo');

      // 3. 同じ人の組：drop は from の、keep は into の生きている人。drop は1回だけ
      const activeIds = async (hid: number) =>
        new Set((await rowsOf(tx, "SELECT id FROM recital_people WHERE household_id = ? AND status = 'active'", [hid])).map((r) => Number(r.id)));
      const fromPeople = await activeIds(fromId);
      const intoPeople = await activeIds(intoId);
      const drops = new Set<number>();
      for (const s of pairs) {
        if (!fromPeople.has(s.dropPersonId) || !intoPeople.has(s.keepPersonId) || drops.has(s.dropPersonId)) throw new CodeFail<MergeFailCode>('bad_pair');
        drops.add(s.dropPersonId);
      }

      // 4. 人を移す。同じ人の二重は withdrawn にして出演を out
      const at = nowUtcIso();
      await tx.execute({ sql: 'UPDATE recital_people SET household_id = ? WHERE household_id = ?', args: [intoId, fromId] });
      for (const s of pairs) {
        await tx.execute({ sql: "UPDATE recital_people SET status = 'withdrawn', merged_into = ? WHERE id = ?", args: [s.keepPersonId, s.dropPersonId] });
        await tx.execute({
          sql: "UPDATE recital_casts SET status = 'out', withdrawn_at = ?, withdraw_reason = ? WHERE person_id = ? AND status IN ('in', 'maybe')",
          args: [at, WITHDRAW_SAME_PERSON, s.dropPersonId],
        });
      }

      // 5. 請求の作り直し（from の行は全部 void になる）
      await recomputeChargesTx(tx, intoId, staffName);
      await recomputeChargesTx(tx, fromId, staffName);

      // 6. 入金を「移した」調整の2行で移す
      const [ps] = await rowsOf(tx, 'SELECT COALESCE(SUM(amount), 0) AS n FROM recital_payments WHERE household_id = ?', [fromId]);
      const moved = Number(ps?.n ?? 0);
      if (moved !== 0) {
        const today = todayJst();
        for (const [hid, amount] of [[fromId, -moved], [intoId, moved]] as const) {
          const ins = await tx.execute({
            sql: `INSERT INTO recital_payments (event_key, household_id, method, amount, paid_on, source, confirmed_by, memo, created_at)
                  VALUES (?, ?, 'adjust', ?, ?, 'manual', ?, ?, ?)`,
            args: [eventKey, hid, amount, today, staffName, MEMO_MOVED, at],
          });
          await logChangeTx(tx, {
            eventKey, householdId: hid, action: 'payment_recorded', actor: staffName,
            before: { told: null },
            after: {
              paymentId: Number(ins.lastInsertRowid), method: 'adjust', amount, source: 'manual', bankRowId: null, refundId: null,
              memo: MEMO_MOVED, fromId, intoId,
            },
          });
        }
      }

      // 7. 「振り込みました」の印：from にあり into に無ければ写す。from は空にする（記録は日と金額だけ。名義は入れない）
      let told: { moved: boolean; date: string; amount: number } | null = null;
      if (hf.bank_told_at != null) {
        const moveTold = hi.bank_told_at == null;
        told = { moved: moveTold, date: String(hf.bank_told_date ?? ''), amount: Number(hf.bank_told_amount ?? 0) };
        if (moveTold) {
          await tx.execute({
            sql: `UPDATE recital_households SET bank_told_at = ?, bank_told_date = ?, bank_told_name = ?, bank_told_amount = ?, bank_told_by = ? WHERE id = ?`,
            args: [hf.bank_told_at, hf.bank_told_date, hf.bank_told_name, hf.bank_told_amount, hf.bank_told_by, intoId],
          });
        }
        await tx.execute({
          sql: `UPDATE recital_households SET bank_told_at = NULL, bank_told_date = NULL, bank_told_name = NULL, bank_told_amount = NULL, bank_told_by = NULL WHERE id = ?`,
          args: [fromId],
        });
      }

      // 8. from を閉じる。返す分2番（式は 9 の refundForDecrease）
      await tx.execute({ sql: "UPDATE recital_households SET status = 'merged', merged_into = ? WHERE id = ?", args: [intoId, fromId] });
      const after = await readHouseholdMoneyTx(tx, intoId);
      const totalBefore = bf.m.total + bi.m.total;
      const paidSum = bf.m.paid + bi.m.paid;
      const refund = refundForDecrease({ totalBefore, paid: paidSum, totalAfter: after.m.total });
      if (refund > 0) {
        await createRefundTx(tx, { householdId: intoId, amount: refund, reasonNo: 2, reason: REASON_MERGED, createdBy: 'system' });
      }

      // 9. 記録（整理番号はどちらも変えない）
      await logChangeTx(tx, {
        eventKey, householdId: intoId, action: 'household_merged', actor: staffName, reason,
        before: { fromId, intoId, totalBefore },
        after: { totalAfter: after.m.total, refund, ...(told ? { told } : {}) },
      });
      return { ok: true as const, totalBefore, totalAfter: after.m.total, moved, refund };
    });
  } catch (e) {
    if (e instanceof CodeFail) return { ok: false, code: e.code as MergeFailCode };
    throw e;
  }

  if (!dryRun) {
    try {
      await expireOpenCheckout(fromId, 'merged');
    } catch (e) {
      console.error(`[recital] まとめた世帯の開いている支払いを閉じられませんでした household=${fromId}`, errText(e));
    }
    try {
      await afterMoneyChanged(intoId, 'total');
    } catch (e) {
      console.error(`[recital] afterMoneyChanged に失敗しました household=${intoId}`, errText(e));
    }
    await sendChangeMail(intoId);
    await sendChangeMail(fromId);
  }
  return out;
}

async function adjustActiveCountTx(tx: Transaction, householdId: number): Promise<number> {
  const [r] = await rowsOf(tx, "SELECT COUNT(*) AS n FROM recital_charges WHERE household_id = ? AND item_code = 'adjust' AND status = 'active'", [householdId]);
  return Number(r?.n ?? 0);
}

// ---------- 照合を決める（5-8） ----------

/** 照合の候補（matchMember の candidateIds の会員）と、その発表会の事前登録 { 会員 id: 種類 } */
export async function listMatchCandidates(personId: number): Promise<{ candidates: MemberLite[]; presets: Record<number, PresetClass> }> {
  if (!isId(personId)) fail('no_person');
  const p = await getOne('SELECT event_key, last_name, first_name, last_kana, first_kana, birthday FROM recital_people WHERE id = ?', [personId]);
  if (!p) fail('no_person');
  const members = await loadMembersLite();
  const m = matchMember(
    {
      lastKana: String(p.last_kana ?? ''), firstKana: String(p.first_kana ?? ''), lastName: String(p.last_name ?? ''), firstName: String(p.first_name ?? ''),
      birthday: p.birthday == null ? null : String(p.birthday),
    },
    members,
  );
  const byId = new Map(members.map((x) => [x.id, x]));
  const candidates = m.candidateIds.map((id) => byId.get(id)).filter((x): x is MemberLite => x != null);
  const presets: Record<number, PresetClass> = {};
  for (const r of await getAll('SELECT member_id, fee_class FROM recital_fee_presets WHERE event_key = ?', [String(p.event_key)])) {
    const fc = toFeeClass(r.fee_class);
    if (fc) presets[Number(r.member_id)] = fc;
  }
  return { candidates, presets };
}

/**
 * 照合を決める。{ none: true } は「会員ではない」、{ memberId } はその会員と結ぶ（manual）。
 * 結んだ会員に事前登録があり、人の印が空なら、特別な料金と同じ中身（印 → 作り直し → 返す分3番 → fee_class_set）を同じ tx で。
 * 印がもう入っていれば変えない（K226）。記録 match_decided には会員の番号と状態だけ（名前・カナ・生年月日は入れない）。
 */
export async function decideMemberMatch(
  personId: number,
  choice: { memberId: number } | { none: true },
  reason: string,
  staffName: string,
  opts?: { dryRun?: boolean },
): Promise<FeeChangePreview & { presetClass: PresetClass | null; keptClass: FeeClass }> {
  checkStaff(staffName);
  if (isBlank(reason)) fail('reason');
  if (!isId(personId)) fail('no_person');
  const none = !!choice && 'none' in choice && choice.none === true;
  const memberId = !none && choice && 'memberId' in choice ? choice.memberId : null;
  if (!none && !isId(memberId)) fail('bad_choice');
  const dryRun = opts?.dryRun === true;
  const r = await runTx(dryRun, async (tx) => {
    const p = await readActivePersonTx(tx, personId);
    let presetClass: PresetClass | null = null;
    if (memberId != null) {
      const [m] = await rowsOf(tx, 'SELECT id FROM boom_members WHERE id = ?', [memberId]);
      if (!m) fail('no_member');
      const [pr] = await rowsOf(tx, 'SELECT fee_class FROM recital_fee_presets WHERE event_key = ? AND member_id = ?', [p.eventKey, memberId]);
      presetClass = pr ? toFeeClass(pr.fee_class) : null;
    }
    const status = none ? 'none' : 'manual';
    await tx.execute({ sql: 'UPDATE recital_people SET member_id = ?, match_status = ? WHERE id = ?', args: [memberId, status, p.id] });
    const applies = presetClass !== null && p.feeClass === null;
    const base = applies ? await applyFeeClassTx(tx, p, presetClass, reason.trim(), staffName) : await unchangedTx(tx, p.householdId);
    await logChangeTx(tx, {
      eventKey: p.eventKey, householdId: p.householdId, personId: p.id, action: 'match_decided', actor: staffName, reason: reason.trim(),
      before: { memberId: p.memberId, status: p.matchStatus }, after: { memberId, status },
    });
    return {
      householdId: p.householdId,
      preview: { ...base, adjustActive: await adjustActiveTx(tx, p.householdId), presetClass, keptClass: applies ? presetClass : p.feeClass },
    };
  });
  if (!dryRun && r.preview.totalAfter !== r.preview.totalBefore) await afterTotalChanged(r.householdId);
  return r.preview;
}
