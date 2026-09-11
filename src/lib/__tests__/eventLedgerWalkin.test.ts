import { describe, it, expect } from 'vitest';
import { summarizeEventFinance, type AppRevenue } from '../eventLedger';

// 当日券(予約なしで来たお客さん)は入場受付でその場の現金で売る(TARO 2026-09-11)。
// 売上にも回収済みにも入れる。カード決済ではないので手数料は掛けない。
const app = (extra: Partial<AppRevenue> = {}): AppRevenue => ({
  entry: 10000,
  ticketAdult: 4000,
  ticketChild: 1000,
  stream: 0,
  paid: 12000,
  cashDue: 3000,
  walkin: 0,
  ...extra,
});

describe('当日券の売上', () => {
  it('アプリの売上に当日券を足す', () => {
    const f = summarizeEventFinance({ app: app({ walkin: 6000 }), ledger: [] });
    expect(f.revenue.app).toBe(10000 + 4000 + 1000 + 6000);
  });

  it('当日券はその場で受け取っているので回収済みに入る', () => {
    const f = summarizeEventFinance({ app: app({ walkin: 6000 }), ledger: [] });
    expect(f.collected).toBe(12000 + 6000);
    expect(f.receivable).toBe(3000);
  });

  it('当日券には決済手数料を掛けない(現金のため)', () => {
    const withWalkin = summarizeEventFinance({ app: app({ walkin: 6000 }), ledger: [] });
    const without = summarizeEventFinance({ app: app(), ledger: [] });
    expect(withWalkin.cost.stripeFee).toBe(without.cost.stripeFee);
  });
});
