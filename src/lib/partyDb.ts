// パーティー申込のDBアクセス層。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
// 枠の考え方(出演エントリーの先着):
//   - 枠を使っている = status IN ('paid','cash_due') + 決済待ち'pending'(30分の仮押さえ)
//   - 期限切れの 'pending' は読む前に sweep で 'expired' にして枠を空ける
//   - 上限の判定と作成は1つの書き込みトランザクション(同時送信で上限を超えないように)
import type { Transaction } from '@libsql/client';
import { execute, getAll, getOne, withWriteTx } from '@/lib/db';
import { generateEditToken } from '@/lib/eventSignup';
import {
  entryUnitPrice,
  partySettingsToRows,
  resolvePartySettings,
  type PartyKind,
  type PartyPayMethod,
  type PartySettings,
  type PartyStatus,
  type ValidatedEntry,
  type ValidatedTicket,
  type EntryMember,
} from '@/lib/party';

const HOLD_MINUTES = 30;
const HOLDING = "('paid','cash_due','pending')";

function nowIso(): string {
  return new Date().toISOString();
}

export interface PartyOrder {
  id: number;
  eventKey: string;
  kind: PartyKind;
  buyerName: string;
  buyerKana: string;
  email: string;
  phone: string;
  isMember: boolean | null;
  peopleCount: number;
  infantCount: number;
  teamName: string;
  teamKana: string;
  genre: string;
  memberCount: number;
  members: EntryMember[];
  payMethod: PartyPayMethod;
  status: PartyStatus;
  unitPrice: number;
  amountTotal: number;
  stripeSessionId: string;
  expiresAt: string;
  audioUrl: string;
  audioFilename: string;
  audioUploadedAt: string;
  audioRemindedAt: string;
  staffNote: string;
  createdAt: string;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB行 */
function rowToOrder(r: any, members: EntryMember[]): PartyOrder {
  return {
    id: Number(r.id),
    eventKey: String(r.event_key),
    kind: r.kind === 'entry' ? 'entry' : 'ticket',
    buyerName: String(r.buyer_name),
    buyerKana: String(r.buyer_kana ?? ''),
    email: String(r.email),
    phone: String(r.phone ?? ''),
    isMember: r.is_member == null ? null : Number(r.is_member) === 1,
    peopleCount: Number(r.people_count ?? 0),
    infantCount: Number(r.infant_count ?? 0),
    teamName: String(r.team_name ?? ''),
    teamKana: String(r.team_kana ?? ''),
    genre: String(r.genre ?? ''),
    memberCount: Number(r.member_count ?? 0),
    members,
    payMethod: r.pay_method === 'card' ? 'card' : 'cash',
    status: String(r.status) as PartyStatus,
    unitPrice: Number(r.unit_price ?? 0),
    amountTotal: Number(r.amount_total ?? 0),
    stripeSessionId: String(r.stripe_session_id ?? ''),
    expiresAt: String(r.expires_at ?? ''),
    audioUrl: String(r.audio_url ?? ''),
    audioFilename: String(r.audio_filename ?? ''),
    audioUploadedAt: String(r.audio_uploaded_at ?? ''),
    audioRemindedAt: String(r.audio_reminded_at ?? ''),
    staffNote: String(r.staff_note ?? ''),
    createdAt: String(r.created_at),
  };
}

async function membersOf(orderId: number): Promise<EntryMember[]> {
  const rows = await getAll('SELECT name, grade FROM party_entry_members WHERE order_id = ? ORDER BY sort_order, id', [orderId]);
  return rows.map((r) => ({ name: String(r.name), grade: String(r.grade ?? '') }));
}

// ---- 設定 ----

export async function getPartySettings(eventKey: string): Promise<PartySettings> {
  const rows = await getAll('SELECT key, value FROM party_settings WHERE event_key = ?', [eventKey]);
  const map: Record<string, string> = {};
  for (const r of rows) map[String(r.key)] = String(r.value);
  return resolvePartySettings(map);
}

export async function savePartySettings(eventKey: string, s: PartySettings): Promise<void> {
  const now = nowIso();
  for (const [key, value] of Object.entries(partySettingsToRows(s))) {
    await execute(
      'INSERT INTO party_settings (event_key, key, value, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(event_key, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
      [eventKey, key, value, now]
    );
  }
}

// ---- 枠 ----

/** 30分過ぎた決済待ちを expired にして枠を空ける。読み取り系の入口で呼ぶ。 */
export async function sweepExpiredPartyOrders(): Promise<number> {
  const now = nowIso();
  const r = await execute(
    "UPDATE party_orders SET status = 'expired', updated_at = ? WHERE status = 'pending' AND expires_at != '' AND expires_at < ?",
    [now, now]
  );
  return Number(r.rowsAffected ?? 0);
}

export async function countHoldingTeams(eventKey: string): Promise<number> {
  await sweepExpiredPartyOrders();
  const row = await getOne(
    `SELECT COUNT(*) AS n FROM party_orders WHERE event_key = ? AND kind = 'entry' AND status IN ${HOLDING}`,
    [eventKey]
  );
  return Number(row?.n ?? 0);
}

// ---- 作成 ----

export type CreatePartyResult =
  | { ok: true; orderId: number; token: string; amountTotal: number }
  | { ok: false; error: string };

interface NewOrderRow {
  kind: PartyKind;
  buyerName: string;
  buyerKana: string;
  email: string;
  phone: string;
  isMember: boolean | null;
  peopleCount: number;
  infantCount: number;
  teamName: string;
  teamKana: string;
  genre: string;
  memberCount: number;
  payMethod: PartyPayMethod;
  unitPrice: number;
  amountTotal: number;
}

async function insertOrder(tx: Transaction, eventKey: string, o: NewOrderRow, token: string): Promise<number> {
  const now = nowIso();
  const isCard = o.payMethod === 'card';
  const res = await tx.execute({
    sql: `INSERT INTO party_orders (event_key, kind, buyer_name, buyer_kana, email, phone, is_member,
      people_count, infant_count, team_name, team_kana, genre, member_count, pay_method, status, unit_price, amount_total,
      edit_token, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      eventKey, o.kind, o.buyerName, o.buyerKana, o.email, o.phone,
      o.isMember == null ? null : o.isMember ? 1 : 0,
      o.peopleCount, o.infantCount, o.teamName, o.teamKana, o.genre, o.memberCount,
      o.payMethod, isCard ? 'pending' : 'cash_due', o.unitPrice, o.amountTotal, token,
      isCard ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString() : '',
      now, now,
    ],
  });
  return Number(res.lastInsertRowid);
}

export async function createPartyTicket(eventKey: string, v: ValidatedTicket, s: PartySettings): Promise<CreatePartyResult> {
  const token = generateEditToken();
  const unitPrice = s.presalePrice;
  const amountTotal = unitPrice * v.peopleCount;
  try {
    const orderId = await withWriteTx((tx) =>
      insertOrder(
        tx,
        eventKey,
        {
          kind: 'ticket', buyerName: v.buyerName, buyerKana: v.buyerKana, email: v.email, phone: v.phone,
          isMember: v.isMember, peopleCount: v.peopleCount, infantCount: v.infantCount,
          teamName: '', teamKana: '', genre: '', memberCount: 0, payMethod: v.payMethod, unitPrice, amountTotal,
        },
        token
      )
    );
    return { ok: true, orderId, token, amountTotal };
  } catch (e) {
    console.error('[party] create ticket failed', e instanceof Error ? e.message : e);
    return { ok: false, error: '申込の保存に失敗しました。時間をおいてお試しください' };
  }
}

export async function createPartyEntry(eventKey: string, v: ValidatedEntry, s: PartySettings): Promise<CreatePartyResult> {
  await sweepExpiredPartyOrders();
  const token = generateEditToken();
  const unitPrice = entryUnitPrice(s);
  const amountTotal = unitPrice * v.members.length;
  try {
    const orderId = await withWriteTx(async (tx) => {
      const cnt = await tx.execute({
        sql: `SELECT COUNT(*) AS n FROM party_orders WHERE event_key = ? AND kind = 'entry' AND status IN ${HOLDING}`,
        args: [eventKey],
      });
      if (Number(cnt.rows[0]?.n ?? 0) >= s.teamCap) throw new FullError();
      const id = await insertOrder(
        tx,
        eventKey,
        {
          kind: 'entry', buyerName: v.buyerName, buyerKana: v.buyerKana, email: v.email, phone: v.phone,
          isMember: null, peopleCount: 0, infantCount: 0, teamName: v.teamName, teamKana: v.teamKana, genre: v.genre,
          memberCount: v.members.length, payMethod: v.payMethod, unitPrice, amountTotal,
        },
        token
      );
      let sort = 0;
      for (const m of v.members) {
        await tx.execute({
          sql: 'INSERT INTO party_entry_members (order_id, name, grade, sort_order) VALUES (?, ?, ?, ?)',
          args: [id, m.name, m.grade, sort++],
        });
      }
      return id;
    });
    return { ok: true, orderId, token, amountTotal };
  } catch (e) {
    if (e instanceof FullError) {
      return { ok: false, error: '申し訳ありません。出演チームは定員に達したため受付を終了しました' };
    }
    console.error('[party] create entry failed', e instanceof Error ? e.message : e);
    return { ok: false, error: 'エントリーの保存に失敗しました。時間をおいてお試しください' };
  }
}

class FullError extends Error {}

// ---- 読み取り ----

/** edit_token 完全一致の1件だけ返す(公開ページ用。列挙できる経路は作らない)。 */
export async function loadPartyOrderByToken(token: string): Promise<PartyOrder | null> {
  if (!token || !/^[0-9a-f]{20,64}$/.test(token)) return null;
  await sweepExpiredPartyOrders();
  const r = await getOne('SELECT * FROM party_orders WHERE edit_token = ? LIMIT 1', [token]);
  if (!r) return null;
  return rowToOrder(r, r.kind === 'entry' ? await membersOf(Number(r.id)) : []);
}

export async function listPartyOrdersStaff(eventKey: string): Promise<PartyOrder[]> {
  await sweepExpiredPartyOrders();
  const rows = await getAll('SELECT * FROM party_orders WHERE event_key = ? ORDER BY id DESC', [eventKey]);
  const members = await getAll(
    'SELECT m.order_id, m.name, m.grade FROM party_entry_members m JOIN party_orders o ON o.id = m.order_id WHERE o.event_key = ? ORDER BY m.sort_order, m.id',
    [eventKey]
  );
  const byOrder = new Map<number, EntryMember[]>();
  for (const m of members) {
    const id = Number(m.order_id);
    byOrder.set(id, [...(byOrder.get(id) ?? []), { name: String(m.name), grade: String(m.grade ?? '') }]);
  }
  return rows.map((r) => rowToOrder(r, byOrder.get(Number(r.id)) ?? []));
}

// ---- スタッフ操作 ----

/** 取消 / 返金済み にする。返金そのものはStripe管理画面で人が行う。 */
export async function setPartyOrderStatusStaff(id: number, status: 'canceled' | 'refunded'): Promise<boolean> {
  const from = status === 'canceled' ? "('paid','cash_due','pending','expired')" : "('paid','canceled')";
  const r = await execute(`UPDATE party_orders SET status = ?, updated_at = ? WHERE id = ? AND status IN ${from}`, [
    status,
    nowIso(),
    id,
  ]);
  return Number(r.rowsAffected ?? 0) > 0;
}

/** 取消を元に戻す。当日現金→cash_due、カード→決済記録があれば paid。 */
/**
 * 取消を元に戻す。当日現金→cash_due、カード→決済記録があれば paid。
 * 出演エントリーは、取消の間に別チームが入って上限に達していたら戻さない(上限超過を防ぐ)。
 */
export async function restorePartyOrderStaff(id: number, teamCap: number): Promise<{ ok: true } | { ok: false; error: string }> {
  await sweepExpiredPartyOrders();
  try {
    await withWriteTx(async (tx) => {
      const r = (await tx.execute({ sql: "SELECT * FROM party_orders WHERE id = ? AND status = 'canceled'", args: [id] })).rows[0];
      if (!r) throw new RestoreError('この申込は取消状態ではありません');
      let next = 'cash_due';
      if (r.pay_method === 'card') {
        const paid = await tx.execute({
          sql: "SELECT 1 AS x FROM party_payments WHERE order_id = ? AND event_type = 'checkout.session.completed' LIMIT 1",
          args: [id],
        });
        if (paid.rows.length === 0) throw new RestoreError('カード決済の記録がないため戻せません');
        next = 'paid';
      }
      if (r.kind === 'entry') {
        const cnt = await tx.execute({
          sql: `SELECT COUNT(*) AS n FROM party_orders WHERE event_key = ? AND kind = 'entry' AND status IN ${HOLDING} AND id != ?`,
          args: [String(r.event_key), id],
        });
        if (Number(cnt.rows[0]?.n ?? 0) >= teamCap) throw new RestoreError('出演チームがすでに上限に達しているため戻せません');
      }
      await tx.execute({ sql: 'UPDATE party_orders SET status = ?, updated_at = ? WHERE id = ?', args: [next, nowIso(), id] });
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof RestoreError) return { ok: false, error: e.message };
    throw e;
  }
}

class RestoreError extends Error {}

export async function setPartyStaffNote(id: number, note: string): Promise<void> {
  await execute('UPDATE party_orders SET staff_note = ?, updated_at = ? WHERE id = ?', [note.slice(0, 500), nowIso(), id]);
}

// ---- 決済 ----

export async function savePartyStripeSession(orderId: number, sessionId: string): Promise<void> {
  await execute('UPDATE party_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?', [sessionId, nowIso(), orderId]);
}

export type ApplyPartyWebhookResult =
  | { status: 'paid'; order: PartyOrder; token: string; amountMismatch: boolean; overCap: boolean }
  | { status: 'duplicate' | 'ignored' | 'order_not_found' | 'not_updated' };

/**
 * 検証済みWebhookイベントを適用する(決済の正本)。
 * - party_payments.stripe_event_id UNIQUE で同じイベントの再送は何もしない
 * - checkout.session.completed で pending/expired を paid に(期限切れ後の決済完了も入金を優先)
 * - 取消・返金済みは paid に戻さない
 */
export async function applyPartyWebhookEvent(
  ev: { eventId: string; type: string; sessionId: string; paymentIntentId: string; orderId: number; amountTotal: number | null },
  rawPayload: string
): Promise<ApplyPartyWebhookResult> {
  const pre = await getOne('SELECT event_key FROM party_orders WHERE id = ? LIMIT 1', [ev.orderId]);
  const teamCap = pre ? (await getPartySettings(String(pre.event_key))).teamCap : Number.MAX_SAFE_INTEGER;
  // 受信記録と注文の更新を1つのトランザクションにする。途中で落ちたら記録ごと戻り、
  // Stripeの再送で正しく適用し直せる(記録だけ残って永久に未反映になるのを防ぐ)。
  const result = await withWriteTx(async (tx) => {
    const ins = await tx.execute({
      sql: 'INSERT OR IGNORE INTO party_payments (stripe_event_id, event_type, stripe_session_id, payment_intent_id, order_id, amount, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [ev.eventId, ev.type, ev.sessionId, ev.paymentIntentId, ev.orderId, ev.amountTotal ?? 0, rawPayload.slice(0, 20000), nowIso()],
    });
    if (Number(ins.rowsAffected ?? 0) === 0) return { status: 'duplicate' as const };
    if (ev.type !== 'checkout.session.completed') return { status: 'ignored' as const };
    const row = (await tx.execute({ sql: 'SELECT * FROM party_orders WHERE id = ? LIMIT 1', args: [ev.orderId] })).rows[0];
    if (!row) return { status: 'order_not_found' as const };
    const st = String(row.status);
    if (st !== 'pending' && st !== 'expired') {
      // 二重決済・取消後の決済など。入金は受けているので、スタッフが返金を判断できるよう印を残す
      const note = `⚠ ${new Date().toISOString().slice(0, 10)} 状態「${st}」の申込にカード決済が完了(二重入金/取消後の入金の可能性・Stripeで返金を確認)`;
      await tx.execute({
        sql: "UPDATE party_orders SET staff_note = trim(staff_note || ' ' || ?), updated_at = ? WHERE id = ?",
        args: [note, nowIso(), ev.orderId],
      });
      return { status: 'not_updated' as const };
    }
    let overCap = false;
    if (row.kind === 'entry' && st === 'expired') {
      // 仮押さえが切れた後の入金: その間に枠が埋まっていたら上限超過として印を残す(入金は無効にしない)
      const cnt = await tx.execute({
        sql: `SELECT COUNT(*) AS n FROM party_orders WHERE event_key = ? AND kind = 'entry' AND status IN ${HOLDING} AND id != ?`,
        args: [String(row.event_key), ev.orderId],
      });
      overCap = Number(cnt.rows[0]?.n ?? 0) >= teamCap;
    }
    await tx.execute({
      sql: "UPDATE party_orders SET status = 'paid', stripe_session_id = ?, updated_at = ? WHERE id = ?",
      args: [ev.sessionId, nowIso(), ev.orderId],
    });
    if (overCap) {
      await tx.execute({
        sql: "UPDATE party_orders SET staff_note = trim(staff_note || ' ' || ?) WHERE id = ?",
        args: ['⚠ 仮押さえ切れの後に入金・出演チームの上限を超えています(要確認)', ev.orderId],
      });
    }
    return { status: 'paid' as const, row, overCap };
  });
  if (result.status !== 'paid') return { status: result.status };
  const row = result.row;
  const order = rowToOrder({ ...row, status: 'paid' }, row.kind === 'entry' ? await membersOf(ev.orderId) : []);
  return {
    status: 'paid',
    order,
    token: String(row.edit_token),
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total),
    overCap: result.overCap,
  };
}

/** 決済ページを作ったら、その有効期限まで仮押さえを延ばす(期限切れ後の入金で上限を超えないように)。 */
export async function extendPartyHold(orderId: number, untilIso: string): Promise<void> {
  await execute(
    "UPDATE party_orders SET expires_at = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND expires_at < ?",
    [untilIso, nowIso(), orderId, untilIso]
  );
}

// ---- 音源 ----

/** 確定済み(paid/cash_due)のエントリーだけ音源を保存できる。差し替えは上書き。 */
export async function savePartyAudio(token: string, url: string, filename: string): Promise<boolean> {
  const r = await execute(
    "UPDATE party_orders SET audio_url = ?, audio_filename = ?, audio_uploaded_at = ?, updated_at = ? WHERE edit_token = ? AND kind = 'entry' AND status IN ('paid','cash_due')",
    [url, filename.slice(0, 200), nowIso(), nowIso(), token]
  );
  return Number(r.rowsAffected ?? 0) > 0;
}

// ---- 音源の後日提出(リマインド・控えURLの再送) ----

/** 確定済みで音源が未提出のエントリー(リマインド対象)。 */
export async function listEntriesMissingAudio(eventKey: string): Promise<{ order: PartyOrder; token: string }[]> {
  await sweepExpiredPartyOrders();
  const rows = await getAll(
    "SELECT * FROM party_orders WHERE event_key = ? AND kind = 'entry' AND status IN ('paid','cash_due') AND audio_url = '' ORDER BY id",
    [eventKey]
  );
  const out: { order: PartyOrder; token: string }[] = [];
  for (const r of rows) out.push({ order: rowToOrder(r, await membersOf(Number(r.id))), token: String(r.edit_token) });
  return out;
}

export async function markAudioReminded(orderId: number): Promise<void> {
  await execute('UPDATE party_orders SET audio_reminded_at = ?, updated_at = ? WHERE id = ?', [nowIso(), nowIso(), orderId]);
}

/** メールアドレスに紐づく確定済みの申込(控えURLの再送用)。呼び出し側は結果の有無を画面に出さないこと。 */
export async function findConfirmedOrdersByEmail(eventKey: string, email: string): Promise<{ order: PartyOrder; token: string }[]> {
  await sweepExpiredPartyOrders();
  const rows = await getAll(
    "SELECT * FROM party_orders WHERE event_key = ? AND lower(email) = lower(?) AND status IN ('paid','cash_due') ORDER BY id",
    [eventKey, email.trim()]
  );
  const out: { order: PartyOrder; token: string }[] = [];
  for (const r of rows) {
    out.push({ order: rowToOrder(r, r.kind === 'entry' ? await membersOf(Number(r.id)) : []), token: String(r.edit_token) });
  }
  return out;
}
