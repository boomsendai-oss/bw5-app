// 観覧のお客さんの入場受付の読み書き。計算は bf6Gate.ts。
import { getAll, getOne, execute } from './db';
import { nowUtcIso } from './dateJst';
import { getBf6Settings } from './bf6Db';
import { buildBreakdownByOrder, normalizeCollector } from './bf6Cash';
import { toOrderLine } from './bf6CashDb';
import {
  buildGateSearchText,
  clampHanded,
  gateSortKey,
  walkinAmount,
  type GateOrder,
  type WalkinSale,
} from './bf6Gate';

/** 観覧チケットがある確定済みの申込(エントリーと同時購入を含む)。 */
export async function listBf6GateOrders(): Promise<GateOrder[]> {
  const [orders, lines, entries, settings] = await Promise.all([
    getAll(
      `SELECT id, buyer_name, phone, payment_status, amount_total FROM bf_orders
        WHERE payment_status IN ('paid','cash_due') ORDER BY id`
    ).catch(() => []),
    getAll(
      `SELECT i.order_id, i.item_type, i.qty, i.unit_amount, i.divisions, i.dancer_name, i.dancer_kana, i.performer_name
         FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
        WHERE o.payment_status IN ('paid','cash_due')
        ORDER BY i.order_id, i.sort_order`
    ).catch(() => []),
    getAll('SELECT order_id, handed FROM bf_gate_entry').catch(() => []),
    getBf6Settings().catch(() => null),
  ]);

  const handed = new Map(entries.map((e) => [Number(e.order_id), Number(e.handed ?? 0)]));
  const parsed = lines.map(toOrderLine);
  const breakdown = buildBreakdownByOrder(parsed, settings?.pricing.entryPerExtraDivision ?? 1500);

  // kana = ダンサーネームの読み(MCが呼ぶ)、realKana = 本名カタカナ(名字の読み・並び順に使う)
  type Acc = { adult: number; child: number; people: string[]; kana: string[]; realKana: string[] };
  const acc = new Map<number, Acc>();
  for (const l of lines) {
    const id = Number(l.order_id);
    const a = acc.get(id) ?? { adult: 0, child: 0, people: [], kana: [], realKana: [] };
    const type = String(l.item_type);
    if (type === 'ticket_adult') a.adult += Number(l.qty ?? 0);
    if (type === 'ticket_child') a.child += Number(l.qty ?? 0);
    if (type === 'entry') {
      if (l.dancer_name) a.people.push(String(l.dancer_name));
      if (l.dancer_kana) a.kana.push(String(l.dancer_kana));
      if (l.performer_name) a.realKana.push(String(l.performer_name));
    }
    acc.set(id, a);
  }

  const out: GateOrder[] = [];
  for (const o of orders) {
    const id = Number(o.id);
    const a = acc.get(id);
    if (!a || a.adult + a.child === 0) continue;
    const paid = String(o.payment_status) === 'paid';
    const buyerName = String(o.buyer_name ?? '');
    out.push({
      orderId: id,
      buyerName,
      people: a.people,
      adult: a.adult,
      child: a.child,
      paid,
      amountDue: paid ? 0 : Number(o.amount_total ?? 0),
      breakdown: paid ? [] : (breakdown.get(id) ?? []),
      handed: handed.get(id) ?? 0,
      searchText: buildGateSearchText({
        buyerName,
        people: a.people,
        kana: [...a.realKana, ...a.kana],
        phone: String(o.phone ?? ''),
      }),
      sortKey: gateSortKey({ buyerName, realNameKana: a.realKana }),
    });
  }
  return out;
}

export type HandResult = { ok: true; handed: number } | { ok: false; error: string };

/**
 * リストバンドを渡した数を足す(戻すときは負の数)。
 * 2人のスタッフが同じ家族に同時に渡しても数がずれないよう、上書きではなく足し算にする。
 * 未払いの申込には渡させない(先に受け取る)。
 */
export async function addBf6GateHanded(orderId: number, delta: number, by: string): Promise<HandResult> {
  const o = await getOne('SELECT payment_status FROM bf_orders WHERE id = ?', [orderId]);
  if (!o) return { ok: false, error: '申込が見つかりません' };
  if (delta > 0 && String(o.payment_status) !== 'paid') {
    return { ok: false, error: 'まだお支払いが済んでいません。先に受け取ってください' };
  }
  const t = await getOne(
    `SELECT COALESCE(SUM(qty), 0) AS n FROM bf_order_items WHERE order_id = ? AND item_type IN ('ticket_adult','ticket_child')`,
    [orderId]
  );
  const tickets = Number(t?.n ?? 0);
  if (tickets === 0) return { ok: false, error: 'この申込に観覧チケットはありません' };

  const cur = await getOne('SELECT handed FROM bf_gate_entry WHERE order_id = ?', [orderId]);
  const next = clampHanded(Number(cur?.handed ?? 0) + delta, tickets);
  await execute(
    `INSERT INTO bf_gate_entry (order_id, handed, handed_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET handed = excluded.handed, handed_by = excluded.handed_by, updated_at = excluded.updated_at`,
    [orderId, next, normalizeCollector(by), nowUtcIso()]
  );
  return { ok: true, handed: next };
}

// ───────── 当日券 ─────────

export async function listBf6WalkinSales(): Promise<WalkinSale[]> {
  const rows = await getAll(
    'SELECT id, adult, child, amount, sold_by, created_at FROM bf_walkin_sale ORDER BY id DESC'
  ).catch(() => []);
  return rows.map((r) => ({
    id: Number(r.id),
    adult: Number(r.adult ?? 0),
    child: Number(r.child ?? 0),
    amount: Number(r.amount ?? 0),
    soldBy: String(r.sold_by ?? ''),
    createdAt: String(r.created_at ?? ''),
  }));
}

/** 当日券を売った記録を残す。金額は画面から受け取らず、料金設定からサーバで計算する。 */
export async function addBf6WalkinSale(adult: number, child: number, by: string): Promise<WalkinSale> {
  const settings = await getBf6Settings();
  const amount = walkinAmount({ adult, child }, settings.pricing);
  const soldBy = normalizeCollector(by);
  const createdAt = nowUtcIso();
  const r = await execute(
    'INSERT INTO bf_walkin_sale (adult, child, amount, sold_by, created_at) VALUES (?, ?, ?, ?, ?)',
    [adult, child, amount, soldBy, createdAt]
  );
  return { id: Number(r.lastInsertRowid), adult, child, amount, soldBy, createdAt };
}

/** 押し間違いの取り消し。 */
export async function deleteBf6WalkinSale(id: number): Promise<void> {
  await execute('DELETE FROM bf_walkin_sale WHERE id = ?', [id]);
}
