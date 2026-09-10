import { describe, it, expect } from 'vitest';
import { cashTotals, sortCashOrders, normalizeCollector, type CashOrder } from '../bf6Cash';

const o = (orderId: number, amountDue: number, extra: Partial<CashOrder> = {}): CashOrder => ({
  orderId,
  buyerName: `買${orderId}`,
  amountDue,
  people: [`D${orderId}`],
  breakdown: [],
  collected: null,
  ...extra,
});

describe('当日現金の集計', () => {
  it('未集金と集金済みを金額で分けて出す', () => {
    const rows = [
      o(1, 4000, { collected: { amount: 4000, at: '2026-09-26T05:00:00Z', by: 'TARO' } }),
      o(2, 6000),
      o(3, 2500),
    ];
    const t = cashTotals(rows);
    expect(t.orders).toBe(3);
    expect(t.collectedOrders).toBe(1);
    expect(t.dueYen).toBe(12500);
    expect(t.collectedYen).toBe(4000);
    expect(t.remainingYen).toBe(8500);
  });

  it('受け取った額が請求額と違っても、実際に受け取った額で集計する', () => {
    // エントリー代だけ先に受け取る運用もありうるため、額は記録されたものを使う
    const rows = [o(1, 6000, { collected: { amount: 2500, at: '2026-09-26T05:00:00Z', by: 'TARO' } })];
    const t = cashTotals(rows);
    expect(t.collectedYen).toBe(2500);
    expect(t.remainingYen).toBe(3500);
    expect(t.shortOrders).toBe(1); // 不足がある注文として数える
  });

  it('1件も無ければ全部ゼロ', () => {
    const t = cashTotals([]);
    expect(t).toMatchObject({ orders: 0, collectedOrders: 0, dueYen: 0, collectedYen: 0, remainingYen: 0 });
  });
});

describe('集金画面の並び', () => {
  it('未集金を先に、その中は名前順', () => {
    const rows = [
      o(1, 1000, { buyerName: 'あ', collected: { amount: 1000, at: 'x', by: 'A' } }),
      o(2, 1000, { buyerName: 'う' }),
      o(3, 1000, { buyerName: 'い' }),
    ];
    expect(sortCashOrders(rows).map((r) => r.orderId)).toEqual([3, 2, 1]);
  });
});

describe('集金係の名前', () => {
  it('前後の空白を落とす', () => {
    expect(normalizeCollector('  TARO  ')).toBe('TARO');
  });

  it('空なら空文字(記録は残すが名前は空でも通す)', () => {
    expect(normalizeCollector('   ')).toBe('');
  });

  it('長すぎる入力は切り詰める', () => {
    expect(normalizeCollector('あ'.repeat(50)).length).toBe(20);
  });
});
