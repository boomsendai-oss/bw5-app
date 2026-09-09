// 当日の受付端末(出場者が自分で操作する)向けのデータ取得。
// 画面に出すのはダンサーネームだけで、本名・連絡先は返さない(端末を出場者が触るため)。
import { getAll } from '@/lib/db';
import { getBf6Settings } from '@/lib/bf6Db';
import type { KioskEntrant } from '@/lib/bf6Kiosk';

/** 当日現金の内訳。「¥8,500」だけ出しても何の金額か分からないため(TARO 2026-09-09)。 */
export type KioskLine = { label: string; qty: number; amount: number };

/** 支払いの消し込みは注文単位なので、注文IDも一緒に持たせる。 */
export type KioskRow = KioskEntrant & { orderId: number; breakdown: KioskLine[] };

const LINE_LABEL: Record<string, string> = {
  ticket_adult: '観覧チケット(中学生以上)',
  ticket_child: '観覧チケット(小学生)',
  stream: 'オンライン配信',
};
const DIV_SHORT: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };

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

  // 当日現金の注文だけ、明細を注文ごとにまとめる(受付で「何の¥8,500か」を見せる)
  const lines = await getAll(
    `SELECT i.order_id, i.item_type, i.qty, i.unit_amount, i.divisions, i.dancer_name
       FROM bf_order_items i JOIN bf_orders o ON o.id = i.order_id
      WHERE o.payment_status = 'cash_due'
      ORDER BY i.order_id, i.sort_order`
  ).catch(() => []);
  // 2部門目以降の追加料金。エントリー1件を部門ごとの行に割って見せるために使う
  //(「バトルエントリー ¥4,000」だけでは何の金額か分からない・TARO 2026-09-09)
  const extra = (await getBf6Settings().catch(() => null))?.pricing.entryPerExtraDivision ?? 1500;
  const entryCountByOrder = new Map<number, number>();
  for (const l of lines) {
    if (String(l.item_type) === 'entry') {
      const k = Number(l.order_id);
      entryCountByOrder.set(k, (entryCountByOrder.get(k) ?? 0) + 1);
    }
  }
  const byOrder = new Map<number, KioskLine[]>();
  for (const l of lines) {
    const k = Number(l.order_id);
    const list = byOrder.get(k) ?? [];
    const qty = Number(l.qty ?? 1);
    const unit = Number(l.unit_amount ?? 0);
    if (String(l.item_type) === 'entry') {
      const divs = JSON.parse(String(l.divisions ?? '[]')) as string[];
      // きょうだいで1注文のときだけ、誰の分か分かるように名前を添える
      const who = (entryCountByOrder.get(k) ?? 0) > 1 ? `${String(l.dancer_name ?? '')} ` : '';
      divs.forEach((d, i) => {
        const amount = i === 0 ? unit - (divs.length - 1) * extra : extra;
        list.push({ label: `${who}${DIV_SHORT[d] ?? d}部門 エントリー`, qty: 1, amount });
      });
    } else {
      list.push({ label: LINE_LABEL[String(l.item_type)] ?? String(l.item_type), qty, amount: qty * unit });
    }
    byOrder.set(k, list);
  }
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
    breakdown: byOrder.get(Number(r.order_id)) ?? [],
    drawnDivisions: byItem.get(Number(r.id)) ?? [],
  }));
}
