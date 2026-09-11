import { describe, it, expect } from 'vitest';
import {
  gateTotals,
  matchesGateQuery,
  sortGateOrders,
  clampHanded,
  ticketCount,
  buildGateSearchText,
  gateSortKey,
  filterGateTab,
  gateTabCounts,
  walkinAmount,
  validateWalkin,
  walkinTotals,
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
  sortKey: `か${orderId}`,
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

describe('名前順(あいうえお順)', () => {
  // 申込者の名前は漢字しか持っていないので、そのまま並べると読みの順にならない。
  // 出場者のフリガナ(親子で名字が同じ)があればそれを読みとして使う(TARO 2026-09-11「名前でソート」)。
  it('フリガナがあれば、ひらがなにした読みを並びの鍵にする', () => {
    expect(gateSortKey({ buyerName: '渡辺 母', kana: ['ワタナベユイ'] })).toBe('わたなべゆい');
  });
  it('フリガナが無ければ申込者の名前を使う(観覧だけの申込)', () => {
    expect(gateSortKey({ buyerName: '山田 太郎', kana: [] })).toBe('山田太郎');
  });
  it('読みの順に並ぶ', () => {
    const rows = [g(1, { sortKey: 'わたなべ' }), g(2, { sortKey: 'あべ' }), g(3, { sortKey: 'さとう' })];
    expect(sortGateOrders(rows).map((r) => r.orderId)).toEqual([2, 3, 1]);
  });
  it('読みの無い漢字だけの行は、読みのある行の後ろにまとめる', () => {
    const rows = [g(1, { sortKey: '山田太郎' }), g(2, { sortKey: 'さとう' })];
    expect(sortGateOrders(rows).map((r) => r.orderId)).toEqual([2, 1]);
  });
});

describe('タブ(まだ・入場済み・全員)', () => {
  // リストバンドを全員ぶん渡したら「まだ」から消える(TARO 2026-09-11)
  const rows = [
    g(1, { adult: 2, handed: 2 }), // 入場済み
    g(2, { adult: 3, handed: 1 }), // 家族の一部だけ来た → まだ
    g(3, { adult: 1, handed: 0 }), // まだ
  ];
  it('まだ入場していない = 全員ぶん渡し終わっていない申込', () => {
    expect(filterGateTab(rows, 'todo').map((r) => r.orderId)).toEqual([2, 3]);
  });
  it('入場済み = 全員ぶん渡した申込', () => {
    expect(filterGateTab(rows, 'done').map((r) => r.orderId)).toEqual([1]);
  });
  it('全員 = すべて', () => {
    expect(filterGateTab(rows, 'all')).toHaveLength(3);
  });
  it('タブごとの件数', () => {
    expect(gateTabCounts(rows)).toEqual({ todo: 2, done: 1, all: 3 });
  });
});

describe('渡した枚数', () => {
  it('0未満にも枚数超えにもならない', () => {
    expect(clampHanded(-1, 3)).toBe(0);
    expect(clampHanded(5, 3)).toBe(3);
    expect(clampHanded(2, 3)).toBe(2);
  });
});

describe('当日券(予約なしで来たお客さん)', () => {
  const pricing = {
    entryBase: 2500, entryPerExtraDivision: 1500, prepaidDiscount: 500,
    ticketAdultPrepaid: 2000, ticketAdultOnsite: 2500, ticketChild: 1000, stream: 1500, showcase: 2000,
  };
  it('大人は当日料金、小学生は小学生料金で計算する', () => {
    expect(walkinAmount({ adult: 2, child: 1 }, pricing)).toBe(2 * 2500 + 1000);
  });
  it('1枚もない・負の数・多すぎる・小数は受け付けない', () => {
    expect(validateWalkin({ adult: 0, child: 0 })).not.toBeNull();
    expect(validateWalkin({ adult: -1, child: 2 })).not.toBeNull();
    expect(validateWalkin({ adult: 21, child: 0 })).not.toBeNull();
    expect(validateWalkin({ adult: 1.5, child: 0 })).not.toBeNull();
  });
  it('普通の枚数は通す', () => {
    expect(validateWalkin({ adult: 2, child: 1 })).toBeNull();
  });
  it('売った件数・枚数・金額を合計する', () => {
    const t = walkinTotals([
      { id: 1, adult: 2, child: 0, amount: 5000, soldBy: 'A', createdAt: 'x' },
      { id: 2, adult: 1, child: 2, amount: 4500, soldBy: 'B', createdAt: 'y' },
    ]);
    expect(t).toEqual({ sales: 2, adult: 3, child: 2, amount: 9500 });
  });
});
