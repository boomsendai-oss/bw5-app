// 当日現金の集金。受付iPad・スタッフの受付画面・集金画面・入場受付の全部がここを通る。
//
// ⚠️ 受け取ったら必ず collectBf6Cash を使う。支払い状況(payment_status)を直接書き換えると
//    「誰がいつ受け取ったか」の控えが残らない(以前は3箇所がばらばらに書き換えていた・2026-09-11)。
import { getAll, getOne, batch } from './db';
import { nowUtcIso } from './dateJst';
import { getBf6Settings } from './bf6Db';
import {
  buildBreakdownByOrder,
  canCollectCash,
  collectedStateFor,
  normalizeCollector,
  type CashCollected,
  type CashOrder,
  type OrderLine,
} from './bf6Cash';

export type CollectResult =
  | { ok: true; alreadyPaid: boolean }
  | { ok: false; error: string };

/**
 * 当日現金を受け取ったことを記録し、申込を支払い済みにする。
 * すでに支払い済みなら何もしない(別の場所で先に受け取っている)。控えも上書きしない。
 */
export async function collectBf6Cash(orderId: number, by: string): Promise<CollectResult> {
  const o = await getOne('SELECT pay_method, payment_status, amount_total FROM bf_orders WHERE id = ?', [orderId]);
  if (!o) return { ok: false, error: '申込が見つかりません' };
  const order = {
    payMethod: String(o.pay_method),
    paymentStatus: String(o.payment_status),
    amountTotal: Number(o.amount_total ?? 0),
  };
  if (!canCollectCash(order)) return { ok: false, error: '当日現金の申込ではありません' };
  if (order.paymentStatus === 'paid') return { ok: true, alreadyPaid: true };

  const now = nowUtcIso();
  await batch([
    {
      sql: `INSERT INTO bf_cash_collect (order_id, amount, collected_at, collected_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(order_id) DO UPDATE SET
              amount = excluded.amount, collected_at = excluded.collected_at, collected_by = excluded.collected_by`,
      args: [orderId, order.amountTotal, now, normalizeCollector(by)],
    },
    {
      sql: "UPDATE bf_orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND payment_status = 'cash_due'",
      args: [now, orderId],
    },
  ]);
  return { ok: true, alreadyPaid: false };
}

/** 押し間違いの取り消し。当日現金の申込だけを未払いに戻す(カード決済には触らない)。 */
export async function undoBf6Cash(orderId: number): Promise<void> {
  await batch([
    { sql: 'DELETE FROM bf_cash_collect WHERE order_id = ?', args: [orderId] },
    {
      sql: "UPDATE bf_orders SET payment_status = 'cash_due', updated_at = ? WHERE id = ? AND pay_method = 'onsite' AND payment_status = 'paid'",
      args: [nowUtcIso(), orderId],
    },
  ]);
}

/** 受付iPadが「集金係が受け取ったか」を確認するためだけに使う。支払い済みかどうか以外は返さない。 */
export async function isBf6OrderPaid(orderId: number): Promise<boolean> {
  const o = await getOne('SELECT payment_status FROM bf_orders WHERE id = ?', [orderId]);
  return String(o?.payment_status ?? '') === 'paid';
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- DB行 */
export function toOrderLine(l: any): OrderLine {
  return {
    orderId: Number(l.order_id),
    itemType: String(l.item_type),
    qty: Number(l.qty ?? 1),
    unitAmount: Number(l.unit_amount ?? 0),
    divisions: String(l.item_type) === 'entry' ? (JSON.parse(String(l.divisions ?? '[]')) as string[]) : [],
    dancerName: String(l.dancer_name ?? ''),
  };
}

/** 当日現金の申込を、内訳と集金状況つきで返す。受け取り済みのものも含む。 */
export async function listBf6CashOrders(): Promise<CashOrder[]> {
  const [orders, lines, records, settings] = await Promise.all([
    getAll(
      `SELECT id, buyer_name, amount_total, payment_status, updated_at FROM bf_orders
        WHERE pay_method = 'onsite' AND payment_status IN ('cash_due','paid') AND amount_total > 0
        ORDER BY id`
    ).catch(() => []),
    getAll(
      `SELECT i.order_id, i.item_type, i.qty, i.unit_amount, i.divisions, i.dancer_name
         FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
        WHERE o.pay_method = 'onsite' AND o.payment_status IN ('cash_due','paid')
        ORDER BY i.order_id, i.sort_order`
    ).catch(() => []),
    getAll('SELECT order_id, amount, collected_at, collected_by FROM bf_cash_collect').catch(() => []),
    getBf6Settings().catch(() => null),
  ]);

  const parsed = lines.map(toOrderLine);
  const breakdown = buildBreakdownByOrder(parsed, settings?.pricing.entryPerExtraDivision ?? 1500);
  const people = new Map<number, string[]>();
  for (const l of parsed) {
    if (l.itemType !== 'entry' || !l.dancerName) continue;
    people.set(l.orderId, [...(people.get(l.orderId) ?? []), l.dancerName]);
  }
  const rec = new Map<number, CashCollected>(
    records.map((c) => [
      Number(c.order_id),
      { amount: Number(c.amount), at: String(c.collected_at), by: String(c.collected_by ?? '') },
    ])
  );

  return orders.map((o) => {
    const id = Number(o.id);
    return {
      orderId: id,
      buyerName: String(o.buyer_name ?? ''),
      amountDue: Number(o.amount_total ?? 0),
      people: people.get(id) ?? [],
      breakdown: breakdown.get(id) ?? [],
      collected: collectedStateFor(
        { paymentStatus: String(o.payment_status), amountTotal: Number(o.amount_total ?? 0), updatedAt: String(o.updated_at ?? '') },
        rec.get(id) ?? null
      ),
    };
  });
}
