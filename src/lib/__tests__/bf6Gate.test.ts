import { describe, it, expect } from 'vitest';
import {
  gateTotals,
  matchesGateQuery,
  sortGateOrders,
  clampHanded,
  ticketCount,
  buildGateSearchText,
  type GateOrder,
} from '../bf6Gate';

const g = (orderId: number, extra: Partial<GateOrder> = {}): GateOrder => ({
  orderId,
  buyerName: `買${orderId}`,
  people: [],
  adult: 1,
  child: 0,
  paid: true,
  amountDue: 0,
  breakdown: [],
  handed: 0,
  searchText: '',
  ...extra,
});

describe('入場受付の集計', () => {
  it('枚数・渡した数・未払いの件数を出す', () => {
    const rows = [
      g(1, { adult: 2, child: 1, handed: 3 }),
      g(2, { adult: 1, handed: 0, paid: false, amountDue: 2500 }),
      g(3, { adult: 2, handed: 1 }),
    ];
    const t = gateTotals(rows);
    expect(t.orders).toBe(3);
    expect(t.tickets).toBe(6);
    expect(t.handed).toBe(4);
    expect(t.remainingTickets).toBe(2);
    expect(t.unpaidOrders).toBe(1);
    expect(t.doneOrders).toBe(1);
  });

  it('枚数は大人と小学生の合計', () => {
    expect(ticketCount(g(1, { adult: 2, child: 3 }))).toBe(5);
  });
});

describe('名前で探す', () => {
  const row = g(1, {
    buyerName: '鈴木 花子',
    people: ['陽翔'],
    searchText: buildGateSearchText({ buyerName: '鈴木 花子', people: ['陽翔'], kana: ['スズキハルト'], phone: '090-1234-5678' }),
  });

  it('申込者の名前で見つかる(空白は無視)', () => {
    expect(matchesGateQuery(row, '鈴木花子')).toBe(true);
  });

  it('子どものダンサーネームで見つかる', () => {
    expect(matchesGateQuery(row, '陽翔')).toBe(true);
  });

  it('ひらがなで名字を言われても、フリガナから見つかる', () => {
    expect(matchesGateQuery(row, 'すずき')).toBe(true);
  });

  it('電話番号の下4桁で見つかる', () => {
    expect(matchesGateQuery(row, '5678')).toBe(true);
  });

  it('全角数字でも見つかる', () => {
    expect(matchesGateQuery(row, '５６７８')).toBe(true);
  });

  it('電話番号の下4桁以外の数字では見つからない(番号を丸ごと持たせない)', () => {
    expect(matchesGateQuery(row, '1234')).toBe(false);
  });

  it('空の検索は全件', () => {
    expect(matchesGateQuery(row, '  ')).toBe(true);
  });
});

describe('一覧の並び', () => {
  it('まだ渡し終わっていない人を先に、その中は名前順', () => {
    const rows = [
      g(1, { buyerName: 'あ', adult: 1, handed: 1 }),
      g(2, { buyerName: 'う', adult: 2, handed: 1 }),
      g(3, { buyerName: 'い', adult: 1, handed: 0 }),
    ];
    expect(sortGateOrders(rows).map((r) => r.orderId)).toEqual([3, 2, 1]);
  });
});

describe('渡した枚数', () => {
  it('0未満にも枚数超えにもならない', () => {
    expect(clampHanded(-1, 3)).toBe(0);
    expect(clampHanded(5, 3)).toBe(3);
    expect(clampHanded(2, 3)).toBe(2);
  });
});
