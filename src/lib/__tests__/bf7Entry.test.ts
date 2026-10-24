import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BF7_SETTINGS,
  bf7SalesGateError,
  buildBf7OrderItems,
  calcBf7OrderTotal,
  calcBf7TicketUnitPrice,
  bf7TicketPayMethodNote,
  formatBf7ReceiptNo,
  formatJpDate,
  isBf7EntryAccepting,
} from '../bf7Entry';
import { calcEntryFee, validateBf6Order } from '../bf6';

const P = DEFAULT_BF7_SETTINGS.pricing;

describe('vol.7の料金(収支計画v2: vol.6から各+¥500)', () => {
  it('エントリー: 1部門¥3,000・追加部門+¥2,000・事前決済は¥500引き', () => {
    expect(calcEntryFee(1, 'onsite', P)).toBe(3000);
    expect(calcEntryFee(1, 'prepaid', P)).toBe(2500);
    expect(calcEntryFee(2, 'onsite', P)).toBe(5000);
  });
  it('観覧: 大人 前売¥2,500/当日¥3,000・小学生¥1,500', () => {
    expect(calcBf7TicketUnitPrice('ticket_adult', 'prepaid', P, '2026-12-01')).toBe(2500);
    expect(calcBf7TicketUnitPrice('ticket_adult', 'onsite', P, '2026-12-01')).toBe(3000);
    expect(calcBf7TicketUnitPrice('ticket_child', 'prepaid', P, '2026-12-01')).toBe(1500);
  });
  it('vol.7の開催日(1/30)からは、カード決済でも大人は当日料金', () => {
    expect(calcBf7TicketUnitPrice('ticket_adult', 'prepaid', P, '2027-01-29')).toBe(2500);
    expect(calcBf7TicketUnitPrice('ticket_adult', 'prepaid', P, '2027-01-30')).toBe(3000);
  });
  it('vol.6の開催日(9/26)を過ぎていても、vol.7はまだ前売(開催日を取り違えない)', () => {
    expect(calcBf7TicketUnitPrice('ticket_adult', 'prepaid', P, '2026-10-20')).toBe(2500);
  });
  it('説明文の金額は単価計算と一致する', () => {
    const n = bf7TicketPayMethodNote(P, '2026-12-01');
    expect(n.prepaid).toContain('¥2,500');
    expect(n.prepaid).toContain('¥3,000');
    expect(bf7TicketPayMethodNote(P, '2027-01-30').discountBadge).toBe(false);
  });
});

describe('明細と合計', () => {
  it('合計と明細の合計が一致する', () => {
    const order = validateBf6Order({
      buyerName: '申込 太郎', email: 'a@example.com', phone: '09012345678', payMethod: 'prepaid',
      entries: [{ performerName: 'テスト', dancerName: 'A', dancerKana: 'エー', grade: 'adult', genre: 'HIPHOP', rep: '仙台', divisions: ['general'] }],
      adultTickets: 2, childTickets: 1,
    });
    if (typeof order === 'string') throw new Error(order);
    const items = buildBf7OrderItems(order, 'prepaid', P, '2026-12-01');
    const sum = items.reduce((s, i) => s + i.qty * i.unitAmount, 0);
    expect(sum).toBe(2500 + 2 * 2500 + 1500);
    expect(calcBf7OrderTotal({ entries: order.entries, adultTickets: 2, childTickets: 1 }, 'prepaid', P, '2026-12-01')).toBe(sum);
  });
});

describe('受付の開閉', () => {
  const open = { ...DEFAULT_BF7_SETTINGS, entryOpen: true, ticketOpen: true, streamOpen: true };
  const cart = (e: number, t: number, s = 0) => ({ entries: Array(e).fill({}), adultTickets: t, childTickets: 0, streamTickets: s });

  it('既定は閉じている(11/30に開けるまで受け付けない)', () => {
    expect(bf7SalesGateError(cart(1, 0), DEFAULT_BF7_SETTINGS, '2026-12-01')).not.toBeNull();
    expect(isBf7EntryAccepting(DEFAULT_BF7_SETTINGS, '2026-12-01')).toBe(false);
  });
  it('開いていても、受付開始日(11/30)より前は受け付けない', () => {
    expect(bf7SalesGateError(cart(1, 0), open, '2026-11-29')).toContain('11/30(月)');
    expect(bf7SalesGateError(cart(1, 0), open, '2026-11-30')).toBeNull();
  });
  it('エントリーは1/28まで・観覧は開催当日(1/30)までオンラインで買える', () => {
    expect(bf7SalesGateError(cart(1, 0), open, '2027-01-29')).not.toBeNull();
    expect(bf7SalesGateError(cart(0, 1), open, '2027-01-30')).toBeNull();
    expect(bf7SalesGateError(cart(0, 1), open, '2027-01-31')).not.toBeNull();
  });
  it('配信は観覧の締切に巻き込まれない(vol.6の事故の再発防止)', () => {
    const s = { ...open, ticketOpen: false };
    expect(bf7SalesGateError(cart(0, 0, 1), s, '2027-01-30')).toBeNull();
  });
});

describe('表記', () => {
  it('受付番号はBF7-001の形', () => expect(formatBf7ReceiptNo(7)).toBe('BF7-007'));
  it('日付は月/日(曜)', () => expect(formatJpDate('2026-11-30')).toBe('11/30(月)'));
});
