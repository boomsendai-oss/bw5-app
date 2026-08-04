// BOOMER'S FIGHT vol.6 のDBアクセス層。src/lib/db.ts 経由のみ(createClient直呼び禁止)。
// 枠の考え方:
//   - 枠を消費する = payment_status IN ('paid','cash_due') + 決済待ち'pending'(30分の仮押さえ)
//   - 公開エントリーリスト・確定数 = 'paid','cash_due' のみ(決済完了までエントリー確定にしない)
//   - 期限切れの 'pending' は読み取り前に sweep で 'expired' 化して枠を解放する
import { getAll, execute, withWriteTx } from '@/lib/db';
import type { Transaction } from '@libsql/client';
import { generateEditToken } from '@/lib/eventSignup';
import {
  DEFAULT_BF6_SETTINGS,
  buildBf6OrderItems,
  countEntriesByDivision,
  divisionRemaining,
  ticketRemaining,
  type Bf6Division,
  type Bf6PayMethod,
  type Bf6Settings,
  type ValidatedBf6Order,
} from '@/lib/bf6';

const HOLD_MINUTES = 30;

function nowIso(): string {
  return new Date().toISOString();
}

function parseDivisions(raw: unknown): Bf6Division[] {
  try {
    const arr = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(arr) ? (arr.filter((d) => ['beginner', 'kids', 'general'].includes(d)) as Bf6Division[]) : [];
  } catch {
    return [];
  }
}

/** bf_settings(key-value) を既定値にマージして返す。 */
export async function getBf6Settings(): Promise<Bf6Settings> {
  const rows = await getAll('SELECT key, value FROM bf_settings');
  const map = new Map<string, string>(rows.map((r) => [String(r.key), String(r.value)]));
  const s: Bf6Settings = structuredClone(DEFAULT_BF6_SETTINGS);
  const tryJson = (key: string, apply: (v: unknown) => void) => {
    const raw = map.get(key);
    if (!raw) return;
    try {
      apply(JSON.parse(raw));
    } catch {
      // 壊れた設定値は無視して既定値を使う
    }
  };
  tryJson('pricing', (v) => Object.assign(s.pricing, v));
  tryJson('capacity', (v) => Object.assign(s.capacity, v));
  if (map.has('hall_capacity')) s.hallCapacity = Number(map.get('hall_capacity')) || s.hallCapacity;
  if (map.has('entry_open')) s.entryOpen = map.get('entry_open') === '1';
  if (map.has('ticket_open')) s.ticketOpen = map.get('ticket_open') === '1';
  if (map.has('entry_deadline')) s.entryDeadline = String(map.get('entry_deadline'));
  if (map.has('ticket_deadline')) s.ticketDeadline = String(map.get('ticket_deadline'));
  return s;
}

export async function setBf6Setting(key: string, value: string): Promise<void> {
  await execute(
    'INSERT INTO bf_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, nowIso()]
  );
}

/** 30分過ぎた決済待ちを expired 化して枠を解放する。読み取り系の入口で必ず呼ぶ。 */
export async function sweepExpiredBf6Orders(): Promise<number> {
  const now = nowIso();
  const r = await execute(
    "UPDATE bf_orders SET payment_status = 'expired', updated_at = ? WHERE payment_status = 'pending' AND expires_at != '' AND expires_at < ?",
    [now, now]
  );
  return Number(r.rowsAffected ?? 0);
}

export interface Bf6Usage {
  divisionCounts: Record<Bf6Division, number>;
  performerCount: number;
  soldTickets: number;
}

interface UsageRow {
  item_type: string;
  divisions: unknown;
  qty: unknown;
}

function aggregateUsage(rows: UsageRow[]): Bf6Usage {
  const divisionCounts: Record<Bf6Division, number> = { beginner: 0, kids: 0, general: 0 };
  let performerCount = 0;
  let soldTickets = 0;
  for (const r of rows) {
    if (r.item_type === 'entry') {
      performerCount += 1;
      for (const d of parseDivisions(r.divisions)) divisionCounts[d] += 1;
    } else if (r.item_type === 'ticket_adult' || r.item_type === 'ticket_child') {
      soldTickets += Number(r.qty) || 0;
    }
  }
  return { divisionCounts, performerCount, soldTickets };
}

const HOLDING_STATUSES = "('paid','cash_due','pending')";

/** 枠を消費している利用状況(確定+仮押さえ)。 */
export async function getBf6Usage(): Promise<Bf6Usage> {
  await sweepExpiredBf6Orders();
  const rows = await getAll(
    `SELECT i.item_type, i.divisions, i.qty FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id WHERE o.payment_status IN ${HOLDING_STATUSES}`
  );
  return aggregateUsage(rows as UsageRow[]);
}

export interface Bf6Remaining {
  divisions: Record<Bf6Division, number>;
  tickets: number;
}

export function calcBf6Remaining(settings: Bf6Settings, usage: Bf6Usage): Bf6Remaining {
  return {
    divisions: {
      beginner: divisionRemaining(settings.capacity.beginner, usage.divisionCounts.beginner),
      kids: divisionRemaining(settings.capacity.kids, usage.divisionCounts.kids),
      general: divisionRemaining(settings.capacity.general, usage.divisionCounts.general),
    },
    tickets: ticketRemaining(settings.hallCapacity, usage.performerCount, usage.soldTickets),
  };
}

export type CreateBf6OrderResult =
  | { ok: true; orderId: number; editToken: string; amountTotal: number }
  | { ok: false; error: string };

/**
 * 注文作成。枠の再チェック→INSERTを1つの書き込みTxで行い、同時申込による定員超過を防ぐ。
 * 事前決済は30分の仮押さえ(pending+expires_at)、当日払いは即確定(cash_due)。
 */
export async function createBf6Order(order: ValidatedBf6Order): Promise<CreateBf6OrderResult> {
  const settings = await getBf6Settings();
  await sweepExpiredBf6Orders();
  const payMethod: Bf6PayMethod = order.payMethod;
  const items = buildBf6OrderItems(order, payMethod, settings.pricing);
  const amountTotal = items.reduce((s, i) => s + i.qty * i.unitAmount, 0);
  const editToken = generateEditToken();
  const now = nowIso();
  const expiresAt =
    payMethod === 'prepaid' ? new Date(Date.now() + HOLD_MINUTES * 60 * 1000).toISOString() : '';
  const paymentStatus = payMethod === 'prepaid' ? 'pending' : 'cash_due';

  try {
    const orderId = await withWriteTx(async (tx: Transaction) => {
      const usageRes = await tx.execute(
        `SELECT i.item_type, i.divisions, i.qty FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id WHERE o.payment_status IN ${HOLDING_STATUSES}`
      );
      const usage = aggregateUsage(usageRes.rows as unknown as UsageRow[]);
      const remaining = calcBf6Remaining(settings, usage);
      const wanted = countEntriesByDivision(order.entries);
      for (const d of ['beginner', 'kids', 'general'] as Bf6Division[]) {
        if (wanted[d] > remaining.divisions[d]) {
          throw new Error(`申し訳ありません。${d === 'beginner' ? '小学生初心者' : d === 'kids' ? '小中学生' : '一般'}部門は残枠が足りません(残り${remaining.divisions[d]}枠)`);
        }
      }
      const wantedTickets = order.adultTickets + order.childTickets;
      if (wantedTickets > remaining.tickets) {
        throw new Error(`申し訳ありません。観覧チケットの残りが足りません(残り${remaining.tickets}枚)`);
      }

      const orderRes = await tx.execute({
        sql: 'INSERT INTO bf_orders (buyer_name, email, phone, pay_method, payment_status, amount_total, edit_token, expires_at, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        args: [order.buyerName, order.email, order.phone, payMethod, paymentStatus, amountTotal, editToken, expiresAt, order.note, now, now],
      });
      const oid = Number(orderRes.lastInsertRowid);
      let sort = 0;
      for (const it of items) {
        await tx.execute({
          sql: 'INSERT INTO bf_order_items (order_id, item_type, performer_name, dancer_name, dancer_kana, grade, genre, rep, instagram, is_first_battle, divisions, qty, unit_amount, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          args: [oid, it.itemType, it.performerName, it.dancerName, it.dancerKana, it.grade, it.genre, it.rep, it.instagram, it.isFirstBattle ? 1 : 0, JSON.stringify(it.divisions), it.qty, it.unitAmount, sort++],
        });
      }
      return oid;
    });
    return { ok: true, orderId, editToken, amountTotal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '申込の保存に失敗しました' };
  }
}

export interface PublicBf6Entry {
  dancerName: string;
  genre: string;
  rep: string;
  divisions: Bf6Division[];
}

/**
 * 公開エントリーリスト。確定分(paid/cash_due)のみ・公開列(ダンサーネーム/ジャンル/REP/部門)のみを
 * SELECTする。本名・連絡先・IG・学年など他の列をこの関数から返してはならない(M22)。
 */
export async function getPublicBf6Entries(): Promise<PublicBf6Entry[]> {
  await sweepExpiredBf6Orders();
  const rows = await getAll(
    "SELECT i.dancer_name, i.genre, i.rep, i.divisions FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id WHERE i.item_type = 'entry' AND o.payment_status IN ('paid','cash_due') ORDER BY i.id ASC"
  );
  return rows.map((r) => ({
    dancerName: String(r.dancer_name),
    genre: String(r.genre ?? ''),
    rep: String(r.rep ?? ''),
    divisions: parseDivisions(r.divisions),
  }));
}

export interface OwnBf6Item {
  itemType: string;
  performerName: string;
  dancerName: string;
  dancerKana: string;
  grade: string;
  genre: string;
  rep: string;
  instagram: string;
  isFirstBattle: boolean;
  divisions: Bf6Division[];
  qty: number;
  unitAmount: number;
}

export interface OwnBf6Order {
  orderId: number;
  buyerName: string;
  email: string;
  phone: string;
  payMethod: Bf6PayMethod;
  paymentStatus: string;
  amountTotal: number;
  expiresAt: string;
  createdAt: string;
  items: OwnBf6Item[];
}

/** 自分の申込1件をトークン完全一致で返す(列挙不可)。 */
export async function loadBf6OrderByToken(token: string): Promise<OwnBf6Order | null> {
  if (!token) return null;
  await sweepExpiredBf6Orders();
  const rows = await getAll('SELECT * FROM bf_orders WHERE edit_token = ? LIMIT 1', [token]);
  const o = rows[0];
  if (!o) return null;
  return rowToOwnOrder(o);
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB行 */
async function rowToOwnOrder(o: any): Promise<OwnBf6Order> {
  const items = await getAll(
    'SELECT * FROM bf_order_items WHERE order_id = ? ORDER BY sort_order ASC, id ASC',
    [Number(o.id)]
  );
  return {
    orderId: Number(o.id),
    buyerName: String(o.buyer_name),
    email: String(o.email),
    phone: String(o.phone),
    payMethod: (o.pay_method === 'onsite' ? 'onsite' : 'prepaid') as Bf6PayMethod,
    paymentStatus: String(o.payment_status),
    amountTotal: Number(o.amount_total),
    expiresAt: String(o.expires_at ?? ''),
    createdAt: String(o.created_at),
    items: items.map((i) => ({
      itemType: String(i.item_type),
      performerName: String(i.performer_name ?? ''),
      dancerName: String(i.dancer_name ?? ''),
      dancerKana: String(i.dancer_kana ?? ''),
      grade: String(i.grade ?? ''),
      genre: String(i.genre ?? ''),
      rep: String(i.rep ?? ''),
      instagram: String(i.instagram ?? ''),
      isFirstBattle: Number(i.is_first_battle) === 1,
      divisions: parseDivisions(i.divisions),
      qty: Number(i.qty),
      unitAmount: Number(i.unit_amount),
    })),
  };
}

/** Checkout Session作成後にIDを控える(突合・再入場用)。 */
export async function saveBf6StripeSession(orderId: number, sessionId: string): Promise<void> {
  await execute('UPDATE bf_orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?', [
    sessionId,
    nowIso(),
    orderId,
  ]);
}

export type ApplyWebhookResult =
  | { status: 'paid'; order: OwnBf6Order; editToken: string; amountMismatch: boolean }
  | { status: 'duplicate' | 'ignored' | 'order_not_found' | 'not_updated' };

/**
 * 検証済みWebhookイベントを適用する(決済の正本)。
 * - bf_payments に stripe_event_id UNIQUE で記録=同一イベント再送は何もしない(冪等)
 * - checkout.session.completed で注文を paid 化。30分超過で expired になった後の
 *   決済完了も paid に戻す(入金済みを無効にしない。枠の重複はスタッフ突合で検知)
 * - 金額不一致でも paid にはする(入金事実を優先)が、フラグを返しスタッフ画面で検知する
 */
export async function applyBf6WebhookEvent(
  ev: {
    eventId: string;
    type: string;
    sessionId: string;
    paymentIntentId: string;
    orderId: number | null;
    amountTotal: number | null;
    currency: string;
  },
  rawPayload: string
): Promise<ApplyWebhookResult> {
  const inserted = await execute(
    'INSERT OR IGNORE INTO bf_payments (stripe_event_id, event_type, stripe_session_id, payment_intent_id, order_id, amount, currency, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [
      ev.eventId,
      ev.type,
      ev.sessionId,
      ev.paymentIntentId,
      ev.orderId,
      ev.amountTotal ?? 0,
      ev.currency || 'jpy',
      rawPayload.slice(0, 20000),
      nowIso(),
    ]
  );
  if (Number(inserted.rowsAffected ?? 0) === 0) return { status: 'duplicate' };
  if (ev.type !== 'checkout.session.completed') return { status: 'ignored' };

  const row = ev.orderId != null
    ? (await getAll('SELECT * FROM bf_orders WHERE id = ? LIMIT 1', [ev.orderId]))[0]
    : (await getAll('SELECT * FROM bf_orders WHERE stripe_session_id = ? LIMIT 1', [ev.sessionId]))[0];
  if (!row) return { status: 'order_not_found' };

  const updated = await execute(
    "UPDATE bf_orders SET payment_status = 'paid', stripe_session_id = ?, updated_at = ? WHERE id = ? AND payment_status IN ('pending', 'expired')",
    [ev.sessionId, nowIso(), Number(row.id)]
  );
  if (Number(updated.rowsAffected ?? 0) === 0) return { status: 'not_updated' };

  const order = await rowToOwnOrder({ ...row, payment_status: 'paid', stripe_session_id: ev.sessionId });
  return {
    status: 'paid',
    order,
    editToken: String(row.edit_token),
    amountMismatch: ev.amountTotal != null && ev.amountTotal !== Number(row.amount_total),
  };
}
