// 当日の受付端末(出場者が自分で操作する)向けのデータ取得。
// 画面に出すのはダンサーネームだけで、本名・連絡先は返さない(端末を出場者が触るため)。
import { getAll } from '@/lib/db';
import type { KioskEntrant } from '@/lib/bf6Kiosk';

/** 支払いの消し込みは注文単位なので、注文IDも一緒に持たせる。 */
export type KioskRow = KioskEntrant & { orderId: number };

/** 出場者の一覧。抽選済みかどうかも一緒に返す。 */
export async function listKioskEntrants(): Promise<KioskRow[]> {
  const rows = await getAll(
    `SELECT i.id, i.dancer_name, i.divisions, o.id AS order_id,
            o.payment_status, o.amount_total, o.pay_method
       FROM bf_order_items i
       JOIN bf_orders o ON o.id = i.order_id
      WHERE i.item_type = 'entry'
        AND o.payment_status IN ('paid','cash_due')
      ORDER BY i.dancer_name`
  ).catch(() => []);

  const drawn = await getAll(
    'SELECT item_id, division FROM bf_draw WHERE item_id IS NOT NULL'
  ).catch(() => []);
  const byItem = new Map<number, string[]>();
  for (const d of drawn) {
    const k = Number(d.item_id);
    const list = byItem.get(k) ?? [];
    list.push(String(d.division));
    byItem.set(k, list);
  }

  return rows.map((r) => ({
    itemId: Number(r.id),
    dancerName: String(r.dancer_name ?? ''),
    divisions: JSON.parse(String(r.divisions ?? '[]')) as string[],
    paymentStatus: String(r.payment_status),
    // 当日現金は注文単位。1回払えば同じ注文の全部門ぶんが済む
    amountDue: r.payment_status === 'cash_due' ? Number(r.amount_total) : 0,
    orderId: Number(r.order_id),
    drawnDivisions: byItem.get(Number(r.id)) ?? [],
  }));
}
