// 当日現金の集金記録。
//
// 事前カード決済をしなかった人は当日会場で現金を払う。
// 集金は人力なので、係の人が「誰から・いくら受け取ったか」を残せるようにする(TARO 2026-09-10)。
// お金は注文単位(きょうだいで1注文なら1回払い)。
//
// ⚠️ 請求額と受け取った額を別々に持つ。
// 「受付ではエントリー代だけ受け取る」運用にする可能性が残っているため、
// 集計は請求額ではなく実際に受け取った額で行う。

export type CashLine = { label: string; qty: number; amount: number };

export type CashCollected = {
  /** 実際に受け取った額 */
  amount: number;
  at: string;
  /** 受け取った係の名前。誰が責任を持ったかを残すためのもの */
  by: string;
};

export type CashOrder = {
  orderId: number;
  /** 申込者(お金を持ってくる人)の名前 */
  buyerName: string;
  /** 請求額 */
  amountDue: number;
  /** この注文に含まれる出場者のダンサーネーム */
  people: string[];
  breakdown: CashLine[];
  collected: CashCollected | null;
};

export type CashTotals = {
  orders: number;
  collectedOrders: number;
  /** 請求額の合計 */
  dueYen: number;
  /** 実際に受け取った額の合計 */
  collectedYen: number;
  /** まだ受け取っていない額 */
  remainingYen: number;
  /** 受け取った額が請求額に足りていない注文の数 */
  shortOrders: number;
};

export function cashTotals(rows: CashOrder[]): CashTotals {
  let collectedOrders = 0;
  let dueYen = 0;
  let collectedYen = 0;
  let shortOrders = 0;
  for (const r of rows) {
    dueYen += r.amountDue;
    if (!r.collected) continue;
    collectedOrders += 1;
    collectedYen += r.collected.amount;
    if (r.collected.amount < r.amountDue) shortOrders += 1;
  }
  return {
    orders: rows.length,
    collectedOrders,
    dueYen,
    collectedYen,
    remainingYen: dueYen - collectedYen,
    shortOrders,
  };
}

/** 未集金を先に。同じ状態どうしは名前順(会場で探しやすい)。 */
export function sortCashOrders(rows: CashOrder[]): CashOrder[] {
  return [...rows].sort((a, b) => {
    const ac = a.collected ? 1 : 0;
    const bc = b.collected ? 1 : 0;
    if (ac !== bc) return ac - bc;
    return a.buyerName.localeCompare(b.buyerName, 'ja');
  });
}

const COLLECTOR_MAX = 20;

export function normalizeCollector(raw: string): string {
  return raw.trim().slice(0, COLLECTOR_MAX);
}

/**
 * 集金済みかどうかは申込の支払い状況(bf_orders.payment_status)を正とする。
 *
 * 受付iPad・スタッフの受付画面・集金画面・入場受付のどこで受け取っても、
 * 申込を「支払い済み」にすれば全画面に同じ状態が出る(TARO 2026-09-11「全部で共有」)。
 * bf_cash_collect は「誰が・いつ・いくら受け取ったか」の控えにすぎない。
 */
export function collectedStateFor(
  order: { paymentStatus: string; amountTotal: number; updatedAt: string },
  record: CashCollected | null
): CashCollected | null {
  if (order.paymentStatus !== 'paid') return null;
  return record ?? { amount: order.amountTotal, at: order.updatedAt, by: '' };
}

/** 集金の対象になる申込。当日現金で、金額があり、キャンセルされていないもの。 */
export function canCollectCash(order: { payMethod: string; paymentStatus: string; amountTotal: number }): boolean {
  return (
    order.payMethod === 'onsite' &&
    (order.paymentStatus === 'cash_due' || order.paymentStatus === 'paid') &&
    order.amountTotal > 0
  );
}

const LINE_LABEL: Record<string, string> = {
  ticket_adult: '観覧チケット(中学生以上)',
  ticket_child: '観覧チケット(小学生)',
  stream: 'オンライン配信',
};
const DIV_SHORT: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };

export type OrderLine = {
  orderId: number;
  itemType: string;
  qty: number;
  unitAmount: number;
  divisions: string[];
  dancerName: string;
};

/**
 * 申込ごとの内訳を作る。「¥8,500」だけでは何の金額か分からないため(TARO 2026-09-09)。
 * エントリー1件を部門ごとの行に割り、2部門目以降は追加料金として別行にする。
 * きょうだいで1申込のときだけ、誰の分かが分かるように名前を添える。
 */
export function buildBreakdownByOrder(lines: OrderLine[], extraPerDivision: number): Map<number, CashLine[]> {
  const entryCount = new Map<number, number>();
  for (const l of lines) {
    if (l.itemType === 'entry') entryCount.set(l.orderId, (entryCount.get(l.orderId) ?? 0) + 1);
  }
  const out = new Map<number, CashLine[]>();
  for (const l of lines) {
    const list = out.get(l.orderId) ?? [];
    if (l.itemType === 'entry') {
      const who = (entryCount.get(l.orderId) ?? 0) > 1 ? `${l.dancerName} ` : '';
      l.divisions.forEach((d, i) => {
        const amount = i === 0 ? l.unitAmount - (l.divisions.length - 1) * extraPerDivision : extraPerDivision;
        list.push({ label: `${who}${DIV_SHORT[d] ?? d}部門 エントリー`, qty: 1, amount });
      });
    } else {
      list.push({ label: LINE_LABEL[l.itemType] ?? l.itemType, qty: l.qty, amount: l.qty * l.unitAmount });
    }
    out.set(l.orderId, list);
  }
  return out;
}
