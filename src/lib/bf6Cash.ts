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
