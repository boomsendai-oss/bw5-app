// BOOMER'S FIGHT!!! vol.7 (2027-01-30) エントリー＆チケット販売の共通ロジック。
//
// 仕組みはvol.6と同じ(TARO 2026-10-20「システムはほぼ前回と同じなので流用して」)。
// 計算と入力チェックはvol.6の部品(src/lib/bf6.ts)をそのまま使い、
// vol.7で違うもの(開催日・料金・受付期間・受付番号)だけをここで決める。
// 注文の保存先はvol.7専用のテーブル(bf7_orders ほか)。vol.6の記録には触れない。
//
// 料金の正本: ~/BOOM/BOOMERS_FIGHT_2026/収支計画_BF7_v2.md(vol.6から各+¥500)
// 料金・定員・受付期間は bf7_settings で上書きできる(スタッフが当日まで調整できるように)。

import { todayJst } from './dateJst';
import {
  bf6EntryPayMethodNote,
  bf6SalesGateError,
  bf6TicketPayMethodNote,
  buildBf6OrderItems,
  calcOrderTotal,
  calcTicketUnitPrice,
  formatReceiptNo,
  isBf6EventDayOrLater,
  isPastDeadlineOn,
  type Bf6Cart,
  type Bf6OrderItemRow,
  type Bf6PayMethod,
  type Bf6PayMethodNote,
  type Bf6Pricing,
  type Bf6Settings,
  type ValidatedBf6Order,
} from './bf6';
import { BF7_EVENT_DATE } from './bf7';

export { BF7_EVENT_DATE };

/** vol.7の設定。vol.6の項目に「受付開始日」を足したもの。 */
export interface Bf7Settings extends Bf6Settings {
  /** エントリーの受付開始日(YYYY-MM-DD・JST)。この日より前は受け付けない。 */
  entryStart: string;
  /** 観覧チケットの販売開始日(YYYY-MM-DD・JST)。 */
  ticketStart: string;
  /** 配信チケットを売るか(観覧の締切とは別に持つ。vol.6の事故の再発防止)。 */
  streamOpen: boolean;
}

export const DEFAULT_BF7_SETTINGS: Bf7Settings = {
  pricing: {
    entryBase: 3000,
    entryPerExtraDivision: 2000,
    prepaidDiscount: 500,
    ticketAdultPrepaid: 2500,
    ticketAdultOnsite: 3000,
    ticketChild: 1500,
    stream: 2000,
    showcase: 3000,
  },
  // 部門と定員は未決定(2026-10-20時点)。vol.6と同じ値で置いておき、決まったら bf7_settings で上書きする
  capacity: { beginner: 16, kids: 32, general: 32 },
  hallCapacity: 200,
  // ⚠️ 既定は「閉」。11/30に開けるまでは受付開始前の表示になる
  entryOpen: false,
  ticketOpen: false,
  streamOpen: false,
  entryStart: '2026-11-30',
  ticketStart: '2026-11-30',
  // エントリーは開催2日前まで(vol.6と同じ)。観覧は開催当日までオンラインで売る
  // (vol.6は既定値が前日のままで、当日の朝にオンライン販売が止まった)
  entryDeadline: '2027-01-28',
  ticketDeadline: BF7_EVENT_DATE,
};

/** 開催日(JST)以降か。この日からは観覧の前売価格が無い。 */
export function isBf7EventDayOrLater(today: string = todayJst()): boolean {
  return isBf6EventDayOrLater(today, BF7_EVENT_DATE);
}

/** 観覧チケット単価(vol.7の開催日で前売/当日を切り替える)。 */
export function calcBf7TicketUnitPrice(
  itemType: 'ticket_adult' | 'ticket_child',
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF7_SETTINGS.pricing,
  today: string = todayJst()
): number {
  return calcTicketUnitPrice(itemType, payMethod, pricing, today, BF7_EVENT_DATE);
}

/** カート合計(vol.7の開催日・料金で)。 */
export function calcBf7OrderTotal(
  cart: Bf6Cart,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF7_SETTINGS.pricing,
  today: string = todayJst()
): number {
  return calcOrderTotal(cart, payMethod, pricing, today, BF7_EVENT_DATE);
}

/** 明細行(単価はサーバ側で確定する)。 */
export function buildBf7OrderItems(
  order: ValidatedBf6Order,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF7_SETTINGS.pricing,
  today: string = todayJst()
): Bf6OrderItemRow[] {
  return buildBf6OrderItems(order, payMethod, pricing, today, BF7_EVENT_DATE);
}

/** 支払い方法の説明文(金額は必ず単価計算と同じ判定から作る)。 */
export function bf7TicketPayMethodNote(
  pricing: Bf6Pricing = DEFAULT_BF7_SETTINGS.pricing,
  today: string = todayJst()
): Bf6PayMethodNote {
  return bf6TicketPayMethodNote(pricing, today, BF7_EVENT_DATE);
}

export function bf7EntryPayMethodNote(
  pricing: Bf6Pricing = DEFAULT_BF7_SETTINGS.pricing,
  today: string = todayJst()
): Bf6PayMethodNote {
  return bf6EntryPayMethodNote(pricing, today, BF7_EVENT_DATE);
}

/**
 * 受付の開閉。カートの中身ごとに、それぞれのフラグ・開始日・締切だけを見る。
 * (エントリー=entry_* / 観覧=ticket_* / 配信=stream_open。1本のゲートに戻さないこと)
 */
export function bf7SalesGateError(
  cart: { entries: unknown[]; adultTickets: number; childTickets: number; streamTickets: number },
  s: Pick<Bf7Settings, 'entryOpen' | 'entryStart' | 'entryDeadline' | 'ticketOpen' | 'ticketStart' | 'ticketDeadline' | 'streamOpen'>,
  today: string = todayJst()
): string | null {
  if (cart.entries.length > 0 && s.entryStart && today < s.entryStart) {
    return `エントリーの受付は${formatJpDate(s.entryStart)}からです`;
  }
  const hasTickets = cart.adultTickets > 0 || cart.childTickets > 0;
  if (hasTickets && s.ticketStart && today < s.ticketStart) {
    return `観覧チケットの販売は${formatJpDate(s.ticketStart)}からです`;
  }
  return bf6SalesGateError(
    cart,
    {
      entryOpen: s.entryOpen,
      entryDeadline: s.entryDeadline,
      ticketOpen: s.ticketOpen,
      ticketDeadline: s.ticketDeadline,
      streamOpen: s.streamOpen,
    },
    today
  );
}

/** 受付中か(画面の出し分け用)。開始日・締切・フラグをまとめて見る。 */
export function isBf7EntryAccepting(s: Pick<Bf7Settings, 'entryOpen' | 'entryStart' | 'entryDeadline'>, today: string = todayJst()): boolean {
  return s.entryOpen && !(s.entryStart && today < s.entryStart) && !isPastDeadlineOn(s.entryDeadline, today);
}

export function isBf7TicketAccepting(s: Pick<Bf7Settings, 'ticketOpen' | 'ticketStart' | 'ticketDeadline'>, today: string = todayJst()): boolean {
  return s.ticketOpen && !(s.ticketStart && today < s.ticketStart) && !isPastDeadlineOn(s.ticketDeadline, today);
}

/** 受付番号の表記(BF7-001)。 */
export function formatBf7ReceiptNo(orderId: number): string {
  return formatReceiptNo(orderId, 'BF7');
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 2026-11-30 → 11/30(月) */
export function formatJpDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${Number(m[2])}/${Number(m[3])}(${WEEKDAYS[d.getUTCDay()]})`;
}
