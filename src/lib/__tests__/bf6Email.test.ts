import { describe, it, expect } from 'vitest';
import { buildBf6OrderEmail } from '../bf6Email';
import type { OwnBf6Order } from '../bf6Db';

function order(partial: Partial<OwnBf6Order> = {}): OwnBf6Order {
  return {
    orderId: 12,
    buyerName: 'テスト 太郎',
    email: 't@example.com',
    phone: '09000000000',
    payMethod: 'card',
    paymentStatus: 'paid',
    amountTotal: 2500,
    createdAt: '2026-09-01T00:00:00Z',
    items: [],
    ...partial,
  } as OwnBf6Order;
}

const entryItem = {
  itemId: 1,
  itemType: 'entry',
  dancerName: 'TARO',
  performerName: '木村 太郎',
  grade: 'elementary',
  genre: 'HIPHOP',
  rep: '仙台',
  divisions: ['beginner'],
  qty: 1,
  unitAmount: 2500,
} as OwnBf6Order['items'][number];

const ticketItem = {
  itemId: 2,
  itemType: 'ticket_adult',
  qty: 2,
  unitAmount: 2000,
} as OwnBf6Order['items'][number];

describe('buildBf6OrderEmail — 出場者の集合案内', () => {
  it('エントリーを含む注文には 13:30集合 と 14:00受付締切 を書く', () => {
    const { text } = buildBf6OrderEmail(order({ items: [entryItem] }), 'tok');
    expect(text).toContain('13:30');
    expect(text).toContain('14:00');
    expect(text).toContain('出場者');
  });

  it('エントリーを含む注文には くじ引き(組み合わせ抽選) の案内を書く', () => {
    const { text } = buildBf6OrderEmail(order({ items: [entryItem] }), 'tok');
    expect(text).toContain('抽選');
  });

  it('観覧チケットのみの注文には集合案内を書かない(開場14:30のまま)', () => {
    const { text } = buildBf6OrderEmail(order({ items: [ticketItem] }), 'tok');
    expect(text).not.toContain('13:30');
    expect(text).toContain('OPEN 14:30');
  });

  it('エントリーと観覧チケットが混在する注文にも集合案内を書く', () => {
    const { text } = buildBf6OrderEmail(order({ items: [entryItem, ticketItem] }), 'tok');
    expect(text).toContain('13:30');
  });
});
