// 当日現金の集金記録の読み書き。金額の計算は bf6Cash.ts に置く。
import { getAll, execute } from './db';
import { nowUtcIso } from './dateJst';
import { getBf6Settings } from './bf6Db';
import { normalizeCollector, type CashLine, type CashOrder } from './bf6Cash';

const LINE_LABEL: Record<string, string> = {
  ticket_adult: '観覧チケット(中学生以上)',
  ticket_child: '観覧チケット(小学生)',
  stream: 'オンライン配信',
};
const DIV_SHORT: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };

/** 当日現金の注文を、明細と集金状況つきで返す。 */
export async function listBf6CashOrders(): Promise<CashOrder[]> {
  const [orders, lines, collected, settings] = await Promise.all([
    getAll(
      `SELECT id, buyer_name, amount_total FROM bf_orders
        WHERE payment_status = 'cash_due' ORDER BY id`
    ).catch(() => []),
    getAll(
      `SELECT i.order_id, i.item_type, i.qty, i.unit_amount, i.divisions, i.dancer_name
         FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
        WHERE o.payment_status = 'cash_due'
        ORDER BY i.order_id, i.sort_order`
    ).catch(() => []),
    getAll('SELECT order_id, amount, collected_at, collected_by FROM bf_cash_collect').catch(() => []),
    getBf6Settings().catch(() => null),
  ]);

  const extra = settings?.pricing.entryPerExtraDivision ?? 1500;

  // きょうだいで1注文のときだけ、明細に誰の分かを添える
  const entryCount = new Map<number, number>();
  for (const l of lines) {
    if (String(l.item_type) === 'entry') {
      const k = Number(l.order_id);
      entryCount.set(k, (entryCount.get(k) ?? 0) + 1);
    }
  }

  const byOrder = new Map<number, CashLine[]>();
  const peopleByOrder = new Map<number, string[]>();
  for (const l of lines) {
    const k = Number(l.order_id);
    const list = byOrder.get(k) ?? [];
    const qty = Number(l.qty ?? 1);
    const unit = Number(l.unit_amount ?? 0);
    if (String(l.item_type) === 'entry') {
      const divs = JSON.parse(String(l.divisions ?? '[]')) as string[];
      const name = String(l.dancer_name ?? '');
      const who = (entryCount.get(k) ?? 0) > 1 ? `${name} ` : '';
      divs.forEach((d, i) => {
        // 2部門目以降は追加料金として別行にする(合計だけでは何の金額か分からない)
        const amount = i === 0 ? unit - (divs.length - 1) * extra : extra;
        list.push({ label: `${who}${DIV_SHORT[d] ?? d}部門 エントリー`, qty: 1, amount });
      });
      const ps = peopleByOrder.get(k) ?? [];
      if (name) ps.push(name);
      peopleByOrder.set(k, ps);
    } else {
      list.push({ label: LINE_LABEL[String(l.item_type)] ?? String(l.item_type), qty, amount: qty * unit });
    }
    byOrder.set(k, list);
  }

  const done = new Map(
    collected.map((c) => [
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
      people: peopleByOrder.get(id) ?? [],
      breakdown: byOrder.get(id) ?? [],
      collected: done.get(id) ?? null,
    };
  });
}

/** 受け取った記録を残す。押し直しても上書きで済むようにする。 */
export async function recordBf6Cash(orderId: number, amount: number, by: string): Promise<void> {
  await execute(
    `INSERT INTO bf_cash_collect (order_id, amount, collected_at, collected_by)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(order_id) DO UPDATE SET
       amount = excluded.amount,
       collected_at = excluded.collected_at,
       collected_by = excluded.collected_by`,
    [orderId, amount, nowUtcIso(), normalizeCollector(by)]
  );
}

/** 押し間違いの取り消し。 */
export async function undoBf6Cash(orderId: number): Promise<void> {
  await execute('DELETE FROM bf_cash_collect WHERE order_id = ?', [orderId]);
}
