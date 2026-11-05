// BF7 HIRO ワークショップの申込のDB操作。純ロジックは bf7Workshop.ts。
// 公開フォーム: src/app/bf7/workshop / スタッフ一覧: src/app/staff/bf7/workshop
//   - 枠を使う = paid・振込待ち transfer_due + カード決済待ち pending(30分の仮押さえ)
//   - 期限切れの pending は読み取り前に expired にして枠を空ける
//   - カード決済の確定はStripeの通知(Webhook)が正本
import { execute, getAll, withWriteTx } from '@/lib/db';
import type { Transaction } from '@libsql/client';
import { generateEditToken } from '@/lib/eventSignup';
import { nowUtcIso, todayJst } from '@/lib/dateJst';
import {
  BF7_WS_CARD_TEST_AMOUNT,
  bf7WsCapacityError,
  bf7WsCourseUses,
  bf7WsPrice,
  checkBf7WsMember,
  calcBf7WsRemaining,
  type Bf7WsMemberCheck,
  type Bf7WsPayMethod,
  type Bf7WsRemaining,
  type ValidatedBf7Ws,
} from '@/lib/bf7Workshop';
import type { MatchableMember } from '@/lib/surveyMatch';

const HOLD_MINUTES = 30;
const USAGE_SQL = `SELECT COALESCE(SUM(class_first), 0) AS first, COALESCE(SUM(class_second), 0) AS second
  FROM bf7_ws_orders WHERE payment_status IN ('paid', 'transfer_due', 'pending') AND is_test = 0`;

export type Bf7WsPaymentStatus = 'pending' | 'paid' | 'transfer_due' | 'expired' | 'canceled';
export type Bf7WsMemberCheckStatus = 'none' | 'confirmed' | 'review' | 'rejected';

export interface Bf7WsOrder {
  id: number;
  name: string;
  kana: string;
  age: string;
  guardianName: string;
  phone: string;
  email: string;
  isMember: boolean;
  memberCheck: Bf7WsMemberCheckStatus;
  matchedMemberId: number | null;
  candidateIds: number[];
  first: boolean;
  second: boolean;
  amountTotal: number;
  payMethod: Bf7WsPayMethod;
  paymentStatus: Bf7WsPaymentStatus;
  stripeSessionId: string;
  appliedOn: string;
  note: string;
  staffNote: string;
  isTest: boolean;
  createdAt: string;
}

function parseIds(raw: unknown): number[] {
  try {
    const a = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(a) ? a.map(Number).filter(Number.isInteger) : [];
  } catch {
    return [];
  }
}

function toOrder(r: Record<string, unknown>): Bf7WsOrder {
  return {
    id: Number(r.id),
    name: String(r.name ?? ''),
    kana: String(r.kana ?? ''),
    age: String(r.age ?? ''),
    guardianName: String(r.guardian_name ?? ''),
    phone: String(r.phone ?? ''),
    email: String(r.email ?? ''),
    isMember: Number(r.is_member) === 1,
    memberCheck: String(r.member_check ?? 'none') as Bf7WsMemberCheckStatus,
    matchedMemberId: r.matched_member_id == null ? null : Number(r.matched_member_id),
    candidateIds: parseIds(r.candidate_ids),
    first: Number(r.class_first) === 1,
    second: Number(r.class_second) === 1,
    amountTotal: Number(r.amount_total ?? 0),
    payMethod: r.pay_method === 'prepaid' ? 'prepaid' : 'transfer',
    paymentStatus: String(r.payment_status ?? 'pending') as Bf7WsPaymentStatus,
    stripeSessionId: String(r.stripe_session_id ?? ''),
    appliedOn: String(r.applied_on ?? ''),
    note: String(r.note ?? ''),
    staffNote: String(r.staff_note ?? ''),
    isTest: Number(r.is_test) === 1,
    createdAt: String(r.created_at ?? ''),
  };
}

export async function sweepExpiredBf7Ws(): Promise<void> {
  await execute(
    "UPDATE bf7_ws_orders SET payment_status = 'expired', updated_at = ? WHERE payment_status = 'pending' AND expires_at != '' AND expires_at < ?",
    [nowUtcIso(), new Date().toISOString()]
  );
}

export async function getBf7WsRemaining(): Promise<Bf7WsRemaining> {
  await sweepExpiredBf7Ws();
  const r = (await getAll(USAGE_SQL))[0];
  return calcBf7WsRemaining({ first: Number(r?.first ?? 0), second: Number(r?.second ?? 0) });
}

/** 照合用の会員データ(在籍者だけでなく退会者も渡す=退会者だけに一致した人をスタッフ確認に回すため) */
export async function listBf7WsMatchableMembers(): Promise<MatchableMember[]> {
  const rows = await getAll('SELECT id, full_name, full_name_kana, rep_name, status FROM boom_members');
  return rows.map((r) => ({
    id: Number(r.id),
    full_name: String(r.full_name ?? ''),
    full_name_kana: String(r.full_name_kana ?? ''),
    rep_name: r.rep_name == null ? null : String(r.rep_name),
    status: String(r.status ?? ''),
  }));
}

export type CreateBf7WsResult =
  | { ok: true; id: number; token: string; amountTotal: number; appliedOn: string }
  | { ok: false; error: string };

export async function createBf7WsOrder(v: ValidatedBf7Ws, memberResult: Bf7WsMemberCheck | null, isTest: boolean): Promise<CreateBf7WsResult> {
  await sweepExpiredBf7Ws();
  const use = bf7WsCourseUses(v.course);
  // 確認用モードのカードは少額で試す(受付開始前にスタッフだけが通れる経路)
  const amountTotal = isTest && v.payMethod === 'prepaid' ? BF7_WS_CARD_TEST_AMOUNT : bf7WsPrice(v.course, v.isMember);
  const token = generateEditToken();
  const now = nowUtcIso();
  const appliedOn = todayJst();
  const prepaid = v.payMethod === 'prepaid';
  const expiresAt = prepaid ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString() : '';
  const memberCheck: Bf7WsMemberCheckStatus = !v.isMember ? 'none' : (memberResult?.check ?? 'review');
  const matchedId = memberResult?.check === 'confirmed' ? memberResult.memberId : null;
  const candidateIds = memberResult?.check === 'review' ? memberResult.candidateIds : [];

  try {
    const id = await withWriteTx(async (tx: Transaction) => {
      // テスト申込は定員に数えないので、満員の判定もしない
      if (!isTest) {
        const res = await tx.execute(USAGE_SQL);
        const row = res.rows[0] as unknown as { first?: unknown; second?: unknown };
        const remaining = calcBf7WsRemaining({ first: Number(row?.first ?? 0), second: Number(row?.second ?? 0) });
        const err = bf7WsCapacityError(v.course, remaining);
        if (err) throw new Error(err);
      }
      const ins = await tx.execute({
        sql: `INSERT INTO bf7_ws_orders
          (edit_token, name, kana, age, guardian_name, phone, email, is_member, member_check, matched_member_id, candidate_ids,
           class_first, class_second, amount_total, pay_method, payment_status, expires_at, applied_on, note, is_test, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          token, v.name, v.kana, v.age, v.guardianName, v.phone, v.email, v.isMember ? 1 : 0, memberCheck, matchedId, JSON.stringify(candidateIds),
          use.first ? 1 : 0, use.second ? 1 : 0, amountTotal, v.payMethod, prepaid ? 'pending' : 'transfer_due', expiresAt, appliedOn, v.note, isTest ? 1 : 0, now, now,
        ],
      });
      return Number(ins.lastInsertRowid);
    });
    return { ok: true, id, token, amountTotal, appliedOn };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '申込の保存に失敗しました' };
  }
}

export async function loadBf7WsOrderByToken(token: string): Promise<Bf7WsOrder | null> {
  if (!token) return null;
  await sweepExpiredBf7Ws();
  const r = (await getAll('SELECT * FROM bf7_ws_orders WHERE edit_token = ? LIMIT 1', [token]))[0];
  return r ? toOrder(r) : null;
}

export async function saveBf7WsStripeSession(id: number, sessionId: string): Promise<void> {
  await execute('UPDATE bf7_ws_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?', [sessionId, nowUtcIso(), id]);
}

export type ApplyBf7WsWebhookResult =
  | { status: 'duplicate' | 'ignored' | 'order_not_found' | 'not_updated' }
  | { status: 'paid'; order: Bf7WsOrder; amountMismatch: boolean };

/** Stripeの決済完了通知を反映する(同じ通知は1回だけ処理)。期限切れの後に完了した決済も有効にする。 */
export async function applyBf7WsWebhookEvent(ev: {
  eventId: string;
  type: string;
  sessionId: string;
  orderId: number;
  amountTotal: number | null;
}): Promise<ApplyBf7WsWebhookResult> {
  const inserted = await execute(
    'INSERT OR IGNORE INTO bf7_ws_payments (stripe_event_id, event_type, stripe_session_id, order_id, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [ev.eventId, ev.type, ev.sessionId, ev.orderId, ev.amountTotal ?? 0, nowUtcIso()]
  );
  if (Number(inserted.rowsAffected ?? 0) === 0) return { status: 'duplicate' };
  if (ev.type !== 'checkout.session.completed') return { status: 'ignored' };

  const row = (await getAll('SELECT * FROM bf7_ws_orders WHERE id = ? LIMIT 1', [ev.orderId]))[0];
  if (!row) return { status: 'order_not_found' };
  const updated = await execute(
    "UPDATE bf7_ws_orders SET payment_status = 'paid', stripe_session_id = ?, updated_at = ? WHERE id = ? AND payment_status IN ('pending', 'expired')",
    [ev.sessionId, nowUtcIso(), ev.orderId]
  );
  if (Number(updated.rowsAffected ?? 0) === 0) return { status: 'not_updated' };
  return {
    status: 'paid',
    order: toOrder({ ...row, payment_status: 'paid', stripe_session_id: ev.sessionId }),
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total),
  };
}

// ===== スタッフ画面 =====

export interface Bf7WsCandidate {
  id: number;
  name: string;
  kana: string;
  status: string;
  repName: string;
}

export interface StaffBf7WsOrder extends Bf7WsOrder {
  matchedName: string;
  candidates: Bf7WsCandidate[];
}

/**
 * 「要確認」の人を最新の会員データで照合し直す。申込のあとに入会した人は、会員データの同期が済めばここで確認済みになる。
 * スタッフが「会員ではない」と判断した人(rejected)は触らない。
 */
export async function recheckBf7WsReview(): Promise<number> {
  const rows = await getAll(
    "SELECT id, name, kana, candidate_ids FROM bf7_ws_orders WHERE member_check = 'review' AND payment_status NOT IN ('expired', 'canceled')"
  );
  if (rows.length === 0) return 0;
  const members = await listBf7WsMatchableMembers();
  let confirmed = 0;
  for (const r of rows) {
    const res = checkBf7WsMember(String(r.name), String(r.kana), members);
    if (res.check === 'confirmed') {
      await execute(
        "UPDATE bf7_ws_orders SET member_check = 'confirmed', matched_member_id = ?, candidate_ids = '[]', updated_at = ? WHERE id = ? AND member_check = 'review'",
        [res.memberId, nowUtcIso(), Number(r.id)]
      );
      confirmed++;
    } else if (JSON.stringify(res.candidateIds) !== String(r.candidate_ids)) {
      await execute('UPDATE bf7_ws_orders SET candidate_ids = ?, updated_at = ? WHERE id = ?', [JSON.stringify(res.candidateIds), nowUtcIso(), Number(r.id)]);
    }
  }
  return confirmed;
}

export async function listBf7WsOrdersStaff(): Promise<StaffBf7WsOrder[]> {
  await sweepExpiredBf7Ws();
  // 照合のやり直しに失敗しても、一覧は出す
  await recheckBf7WsReview().catch((e) => console.error('[bf7ws] recheck failed', e instanceof Error ? e.message : e));
  const orders = (await getAll('SELECT * FROM bf7_ws_orders ORDER BY id')).map(toOrder);
  const ids = Array.from(new Set(orders.flatMap((o) => [...o.candidateIds, ...(o.matchedMemberId ? [o.matchedMemberId] : [])])));
  const byId = new Map<number, Bf7WsCandidate>();
  if (ids.length > 0) {
    const rows = await getAll(
      `SELECT id, full_name, full_name_kana, status, rep_name FROM boom_members WHERE id IN (${ids.map(() => '?').join(',')})`,
      ids
    );
    for (const r of rows) {
      byId.set(Number(r.id), {
        id: Number(r.id),
        name: String(r.full_name ?? ''),
        kana: String(r.full_name_kana ?? ''),
        status: String(r.status ?? ''),
        repName: String(r.rep_name ?? ''),
      });
    }
  }
  return orders.map((o) => ({
    ...o,
    matchedName: o.matchedMemberId ? (byId.get(o.matchedMemberId)?.name ?? '') : '',
    candidates: o.candidateIds.map((id) => byId.get(id)).filter((c): c is Bf7WsCandidate => Boolean(c)),
  }));
}

export async function setBf7WsMemberCheck(id: number, check: 'confirmed' | 'rejected'): Promise<boolean> {
  const r = await execute("UPDATE bf7_ws_orders SET member_check = ?, updated_at = ? WHERE id = ? AND is_member = 1", [check, nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}

/** 銀行振込の入金確認(取り消しもできる)。カード決済の行は変えない */
export async function setBf7WsTransferReceived(id: number, received: boolean): Promise<boolean> {
  const r = await execute(
    `UPDATE bf7_ws_orders SET payment_status = ?, updated_at = ? WHERE id = ? AND pay_method = 'transfer' AND payment_status = ?`,
    [received ? 'paid' : 'transfer_due', nowUtcIso(), id, received ? 'transfer_due' : 'paid']
  );
  return Number(r.rowsAffected) > 0;
}

export async function getBf7WsOrderById(id: number): Promise<Bf7WsOrder | null> {
  const r = (await getAll('SELECT * FROM bf7_ws_orders WHERE id = ? LIMIT 1', [id]))[0];
  return r ? toOrder(r) : null;
}

/** 取消(枠が空く)。カード決済の返金はStripeの画面で別に行う */
export async function cancelBf7WsOrder(id: number): Promise<boolean> {
  const r = await execute(
    "UPDATE bf7_ws_orders SET payment_status = 'canceled', updated_at = ? WHERE id = ? AND payment_status IN ('pending', 'paid', 'transfer_due')",
    [nowUtcIso(), id]
  );
  return Number(r.rowsAffected) > 0;
}

export async function setBf7WsStaffNote(id: number, note: string): Promise<boolean> {
  const r = await execute('UPDATE bf7_ws_orders SET staff_note = ?, updated_at = ? WHERE id = ?', [note.slice(0, 500), nowUtcIso(), id]);
  return Number(r.rowsAffected) > 0;
}
