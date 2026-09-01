import { describe, it, expect } from 'vitest';
import { summarizeEventFinance, STRIPE_FEE_RATE } from '../eventLedger';

const app = {
  entry: 95000,
  ticketAdult: 93000,
  ticketChild: 3000,
  stream: 0,
  paid: 151000,
  cashDue: 40000,
};

describe('イベント収支の集計', () => {
  it('アプリの売上は明細の合計になる', () => {
    const s = summarizeEventFinance({ app, ledger: [] });
    expect(s.revenue.app).toBe(191000);
  });

  it('アプリ外の入金(現金集金など)を足して総売上になる', () => {
    const s = summarizeEventFinance({
      app,
      ledger: [{ kind: 'income', label: 'ショーケース出演費', amount: 57500, collected: true }],
    });
    expect(s.revenue.offline).toBe(57500);
    expect(s.revenue.total).toBe(248500);
  });

  it('回収済みと未回収を分ける(当日現金は未回収)', () => {
    const s = summarizeEventFinance({
      app,
      ledger: [{ kind: 'income', label: 'ショーケース出演費', amount: 57500, collected: true }],
    });
    expect(s.collected).toBe(208500);
    expect(s.receivable).toBe(40000);
  });

  it('アプリ外の入金が未回収なら回収済みに入れない', () => {
    const s = summarizeEventFinance({
      app,
      ledger: [{ kind: 'income', label: '協賛金(入金待ち)', amount: 30000, collected: false }],
    });
    expect(s.collected).toBe(151000);
    expect(s.receivable).toBe(70000);
  });

  it('支出は台帳の合計 + カード決済額に対する手数料', () => {
    const s = summarizeEventFinance({
      app,
      ledger: [{ kind: 'cost', label: 'ジャッジ', amount: 60000, collected: false }],
    });
    expect(s.cost.ledger).toBe(60000);
    expect(s.cost.stripeFee).toBe(Math.round(151000 * STRIPE_FEE_RATE));
    expect(s.cost.total).toBe(60000 + Math.round(151000 * STRIPE_FEE_RATE));
  });

  it('利益 = 総売上 − 総支出(未回収も見込みとして含む)', () => {
    const s = summarizeEventFinance({
      app,
      ledger: [
        { kind: 'income', label: 'ショーケース出演費', amount: 57500, collected: true },
        { kind: 'cost', label: 'ジャッジ', amount: 60000, collected: false },
      ],
    });
    expect(s.profit).toBe(248500 - (60000 + Math.round(151000 * STRIPE_FEE_RATE)));
  });

  it('支払い済みの支出と未払いの支出を分けて出す(手元の現金を見るため)', () => {
    const s = summarizeEventFinance({
      app,
      ledger: [
        { kind: 'cost', label: '賞金', amount: 35000, collected: false },
        { kind: 'cost', label: '備品(購入済み)', amount: 15000, collected: true },
      ],
    });
    expect(s.cost.paid).toBe(15000);
    expect(s.cost.unpaid).toBe(35000);
  });

  it('台帳が空でも壊れない', () => {
    const s = summarizeEventFinance({ app, ledger: [] });
    expect(s.revenue.offline).toBe(0);
    expect(s.cost.ledger).toBe(0);
    expect(s.profit).toBe(191000 - Math.round(151000 * STRIPE_FEE_RATE));
  });

  it('カード決済が0なら手数料も0', () => {
    const s = summarizeEventFinance({
      app: { ...app, paid: 0, entry: 0, ticketAdult: 0, ticketChild: 0, stream: 0 },
      ledger: [],
    });
    expect(s.cost.stripeFee).toBe(0);
  });
});
