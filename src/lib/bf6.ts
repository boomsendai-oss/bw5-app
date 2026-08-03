// BOOMER'S FIGHT!!! vol.6 (2026-09-26) エントリー＆事前決済の共通ロジック。
// 料金・定員は bf_settings で上書きできるが、既定値はここに集約する。
// 設計書: ~/BOOM/BOOMERS_FIGHT_2026/エントリーアプリ_設計書_v2.md

export type Bf6PayMethod = 'prepaid' | 'onsite';

export type Bf6Division = 'beginner' | 'kids' | 'general';

export type Bf6Grade =
  | 'preschool'
  | 'es1' | 'es2' | 'es3' | 'es4' | 'es5' | 'es6'
  | 'jhs1' | 'jhs2' | 'jhs3'
  | 'hs1' | 'hs2' | 'hs3'
  | 'adult';

export interface Bf6Pricing {
  entryBase: number;
  entryPerExtraDivision: number;
  prepaidDiscount: number;
  ticketAdultPrepaid: number;
  ticketAdultOnsite: number;
  ticketChild: number;
  stream: number;
  showcase: number;
}

export interface Bf6Settings {
  pricing: Bf6Pricing;
  capacity: Record<Bf6Division, number>;
  hallCapacity: number;
  entryOpen: boolean;
  ticketOpen: boolean;
}

export const DEFAULT_BF6_SETTINGS: Bf6Settings = {
  pricing: {
    entryBase: 2500,
    entryPerExtraDivision: 1500,
    prepaidDiscount: 500,
    ticketAdultPrepaid: 2000,
    ticketAdultOnsite: 2500,
    ticketChild: 1000,
    stream: 1500,
    showcase: 2000,
  },
  capacity: { beginner: 16, kids: 32, general: 32 },
  hallCapacity: 200,
  entryOpen: false,
  ticketOpen: false,
};

/** バトルエントリー1人分の料金。1部門¥2,500 + 追加部門¥1,500、事前決済は一律−¥500。 */
export function calcEntryFee(
  divisionCount: number,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): number {
  if (divisionCount <= 0) return 0;
  const base = pricing.entryBase + (divisionCount - 1) * pricing.entryPerExtraDivision;
  return payMethod === 'prepaid' ? base - pricing.prepaidDiscount : base;
}

/** 観覧チケット単価。大人のみ事前/当日で価格差、小学生は一律。 */
export function calcTicketUnitPrice(
  itemType: 'ticket_adult' | 'ticket_child',
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): number {
  if (itemType === 'ticket_child') return pricing.ticketChild;
  return payMethod === 'prepaid' ? pricing.ticketAdultPrepaid : pricing.ticketAdultOnsite;
}

export interface Bf6Cart {
  entries: { divisions: Bf6Division[] }[];
  adultTickets: number;
  childTickets: number;
}

/** カート合計。エントリー複数人(きょうだい)+観覧同時購入を1決済に載せる。 */
export function calcOrderTotal(
  cart: Bf6Cart,
  payMethod: Bf6PayMethod,
  pricing: Bf6Pricing = DEFAULT_BF6_SETTINGS.pricing
): number {
  const entryTotal = cart.entries.reduce(
    (sum, e) => sum + calcEntryFee(e.divisions.length, payMethod, pricing),
    0
  );
  return (
    entryTotal +
    cart.adultTickets * calcTicketUnitPrice('ticket_adult', payMethod, pricing) +
    cart.childTickets * calcTicketUnitPrice('ticket_child', payMethod, pricing)
  );
}

const ELEMENTARY_GRADES: ReadonlySet<string> = new Set(['es1', 'es2', 'es3', 'es4', 'es5', 'es6']);

export function isElementaryGrade(grade: string): boolean {
  return ELEMENTARY_GRADES.has(grade);
}

/** 初心者部門の出場資格 = 小学生かつバトル初出場のみ。 */
export function canEnterBeginner(grade: string, isFirstBattle: boolean): boolean {
  return isElementaryGrade(grade) && isFirstBattle;
}

/** 部門残枠。確定(=決済済み+当日現金選択)人数を定員から引く。 */
export function divisionRemaining(capacity: number, confirmedCount: number): number {
  return Math.max(0, capacity - confirmedCount);
}

/** 観覧残数 = ホール定員 − 出演者数 − 販売済枚数(出演者本人は無料入場のため枠を食う)。 */
export function ticketRemaining(
  hallCapacity: number,
  performerCount: number,
  soldTickets: number
): number {
  return Math.max(0, hallCapacity - performerCount - soldTickets);
}
