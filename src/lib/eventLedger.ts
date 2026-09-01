// イベント収支の集計(純ロジック・DBに触らない)。
//
// なぜ台帳を持つか: 売上の一部(アプリ経由のエントリー・チケット)はDBにあるが、
// 固定費(ジャッジ・賞金など)とアプリ外の現金(ショーケース出演費など)はどこにも
// 記録されておらず、収支の全体像が人の頭とドキュメントの中にしかなかった。
// 台帳に入れておけば、他のセッションからも同じ数字を読める。

/** Stripeの決済手数料。カード決済額に対して掛かる。 */
export const STRIPE_FEE_RATE = 0.036;

export type LedgerKind = 'income' | 'cost';

export type LedgerRow = {
  kind: LedgerKind;
  label: string;
  amount: number;
  /** 入金:受け取り済み / 支出:支払い済み */
  collected: boolean;
};

/** アプリのDBから拾える売上。 */
export type AppRevenue = {
  entry: number;
  ticketAdult: number;
  ticketChild: number;
  stream: number;
  /** カード決済で入金済みの注文合計 */
  paid: number;
  /** 当日現金(未回収)の注文合計 */
  cashDue: number;
};

export type EventFinance = {
  revenue: { app: number; offline: number; total: number };
  collected: number;
  receivable: number;
  cost: { ledger: number; stripeFee: number; total: number; paid: number; unpaid: number };
  profit: number;
};

export function summarizeEventFinance({
  app,
  ledger,
}: {
  app: AppRevenue;
  ledger: LedgerRow[];
}): EventFinance {
  const appRevenue = app.entry + app.ticketAdult + app.ticketChild + app.stream;

  const incomes = ledger.filter((r) => r.kind === 'income');
  const costs = ledger.filter((r) => r.kind === 'cost');
  const offline = incomes.reduce((s, r) => s + r.amount, 0);

  const offlineCollected = incomes.filter((r) => r.collected).reduce((s, r) => s + r.amount, 0);
  const offlineReceivable = offline - offlineCollected;

  const ledgerCost = costs.reduce((s, r) => s + r.amount, 0);
  const stripeFee = Math.round(app.paid * STRIPE_FEE_RATE);
  const costPaid = costs.filter((r) => r.collected).reduce((s, r) => s + r.amount, 0);

  const total = appRevenue + offline;
  const costTotal = ledgerCost + stripeFee;

  return {
    revenue: { app: appRevenue, offline, total },
    // 回収済み = カード入金 + 受け取り済みのアプリ外入金
    collected: app.paid + offlineCollected,
    // 未回収 = 当日現金 + まだ受け取っていないアプリ外入金
    receivable: app.cashDue + offlineReceivable,
    cost: {
      ledger: ledgerCost,
      stripeFee,
      total: costTotal,
      paid: costPaid,
      unpaid: ledgerCost - costPaid,
    },
    profit: total - costTotal,
  };
}
