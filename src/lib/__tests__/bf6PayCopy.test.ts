import { describe, expect, test } from 'vitest';
import {
  BF6_EVENT_DATE,
  bf6EntryPayMethodNote,
  bf6SalesGateError,
  bf6TicketPayMethodNote,
  calcEntryFee,
  calcTicketUnitPrice,
  isBf6EventDayOrLater,
  DEFAULT_BF6_SETTINGS,
  type Bf6SalesGate,
} from '../bf6';

const P = DEFAULT_BF6_SETTINGS.pricing;
const BEFORE = '2026-09-25';
const ON = BF6_EVENT_DATE; // 2026-09-26

describe('isBf6EventDayOrLater: 当日以降は前売価格が消える', () => {
  test('前日までは false', () => {
    expect(isBf6EventDayOrLater('2026-09-25')).toBe(false);
  });
  test('当日と翌日は true', () => {
    expect(isBf6EventDayOrLater('2026-09-26')).toBe(true);
    expect(isBf6EventDayOrLater('2026-09-27')).toBe(true);
  });
});

// 2026-09-26: 合計は calcTicketUnitPrice で¥2,500になっていたのに、支払い方法欄の
// 説明文だけ「大人は¥2,000」のハードコードで残っていた(表示と請求が食い違った)。
describe('bf6TicketPayMethodNote: /bf6/ticket の支払い方法の説明', () => {
  test('前日までは事前カード決済がおトク。実際の単価と同じ額を書く', () => {
    const note = bf6TicketPayMethodNote(P, BEFORE);
    expect(note.discountBadge).toBe(true);
    expect(note.prepaid).toContain(`¥${calcTicketUnitPrice('ticket_adult', 'prepaid', P, BEFORE).toLocaleString()}`);
    expect(note.prepaid).toContain('¥2,000');
    expect(note.prepaid).toContain('¥2,500');
  });

  test('当日以降は「おトク」バッジを出さない(割引が存在しないため)', () => {
    const note = bf6TicketPayMethodNote(P, ON);
    expect(note.discountBadge).toBe(false);
  });

  test('当日以降の説明文に前売価格(¥2,000)を書かない', () => {
    const note = bf6TicketPayMethodNote(P, ON);
    expect(note.prepaid).not.toContain('¥2,000');
    expect(note.prepaid).toContain('¥2,500');
  });

  test('説明文の大人料金は必ず calcTicketUnitPrice と一致する', () => {
    for (const today of [BEFORE, ON, '2026-09-27']) {
      const unit = calcTicketUnitPrice('ticket_adult', 'prepaid', P, today);
      expect(bf6TicketPayMethodNote(P, today).prepaid).toContain(`¥${unit.toLocaleString()}`);
    }
  });

  test('小学生は一律¥1,000といつでも書く', () => {
    expect(bf6TicketPayMethodNote(P, BEFORE).prepaid).toContain('¥1,000');
    expect(bf6TicketPayMethodNote(P, ON).prepaid).toContain('¥1,000');
  });

  test('料金設定を変えれば文言もついてくる(ハードコードしない)', () => {
    const pricing = { ...P, ticketAdultPrepaid: 1800, ticketAdultOnsite: 2800, ticketChild: 900 };
    const note = bf6TicketPayMethodNote(pricing, BEFORE);
    expect(note.prepaid).toContain('¥1,800');
    expect(note.prepaid).toContain('¥2,800');
    expect(note.prepaid).toContain('¥900');
  });
});

describe('bf6EntryPayMethodNote: /bf6/entry の支払い方法の説明', () => {
  test('前日まではエントリー割引と観覧割引の両方を書く', () => {
    const note = bf6EntryPayMethodNote(P, BEFORE);
    expect(note.discountBadge).toBe(true);
    expect(note.prepaid).toContain('¥500');
    expect(note.prepaid).toContain('¥2,000');
  });

  test('当日以降もエントリー料の¥500引きは残るので、バッジは出したまま', () => {
    // calcEntryFee は日付で変わらない = 事前決済の割引は当日も生きている
    expect(calcEntryFee(1, 'prepaid', P)).toBe(calcEntryFee(1, 'onsite', P) - P.prepaidDiscount);
    const note = bf6EntryPayMethodNote(P, ON);
    expect(note.discountBadge).toBe(true);
    expect(note.prepaid).toContain('¥500');
  });

  test('当日以降は観覧が前売価格だと書かない', () => {
    const note = bf6EntryPayMethodNote(P, ON);
    expect(note.prepaid).not.toContain('¥2,000');
    expect(note.prepaid).toContain('¥2,500');
  });
});

// 2026-09-26: ticket_deadline が既定値 2026-09-25 のままで、観覧だけでなく
// 配信チケットまで終日売れなくなった。配信は観覧の締切に相乗りさせない。
describe('bf6SalesGateError: カートの中身ごとに、それぞれの受付を見る', () => {
  const openGate: Bf6SalesGate = {
    entryOpen: true, entryDeadline: '2026-09-24',
    ticketOpen: true, ticketDeadline: '2026-09-25',
    streamOpen: true,
  };
  const cart = (o: Partial<Parameters<typeof bf6SalesGateError>[0]>) => ({
    entries: [], adultTickets: 0, childTickets: 0, streamTickets: 0, ...o,
  });

  test('観覧の締切が切れていても、配信だけの注文は通る', () => {
    expect(bf6SalesGateError(cart({ streamTickets: 1 }), openGate, '2026-09-26')).toBeNull();
  });

  test('観覧だけの注文は観覧の締切で止まる', () => {
    expect(bf6SalesGateError(cart({ adultTickets: 1 }), openGate, '2026-09-26')).toContain('観覧');
  });

  test('配信の受付を閉じていれば配信だけの注文は止まる', () => {
    const gate = { ...openGate, streamOpen: false };
    expect(bf6SalesGateError(cart({ streamTickets: 1 }), gate, '2026-09-20')).toContain('配信');
  });

  test('配信の受付が閉じていても、観覧だけの注文は通る(逆方向も相乗りさせない)', () => {
    const gate = { ...openGate, streamOpen: false };
    expect(bf6SalesGateError(cart({ adultTickets: 1 }), gate, '2026-09-20')).toBeNull();
  });

  test('エントリーはエントリーの締切で止まる', () => {
    const c = cart({ entries: [{ divisions: ['general'] }] });
    expect(bf6SalesGateError(c, openGate, '2026-09-24')).toBeNull();
    expect(bf6SalesGateError(c, openGate, '2026-09-25')).toContain('エントリー');
  });

  test('観覧を相乗りさせたエントリーは、観覧の締切も見る', () => {
    const c = cart({ entries: [{ divisions: ['general'] }], adultTickets: 1 });
    const gate = { ...openGate, ticketOpen: false };
    expect(bf6SalesGateError(c, gate, '2026-09-24')).toContain('観覧');
  });

  test('締切当日はまだ売れる(翌日から止まる)', () => {
    expect(bf6SalesGateError(cart({ adultTickets: 1 }), openGate, '2026-09-25')).toBeNull();
  });

  test('空のカートは判定の対象外(検証は validateBf6Order の担当)', () => {
    expect(bf6SalesGateError(cart({}), { ...openGate, ticketOpen: false, streamOpen: false }, '2026-09-30')).toBeNull();
  });
});
