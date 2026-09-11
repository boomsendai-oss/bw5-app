// 観覧のお客さんの入場受付。純ロジック・DBに触らない。
//
// 14:30の開場で観覧チケットのお客さんを15分で入れる(TARO 2026-09-11)。
// スタッフが名前を聞いて一覧から探し、支払い済みならリストバンドを渡して「渡した」を押す。
// 当日現金でまだ払っていなければ、その場で受け取ってから渡す。
// 家族がばらばらに来ることがあるので、渡した数は申込ごとに枚数で持つ。
import type { CashLine } from './bf6Cash';
import { calcTicketUnitPrice, type Bf6Pricing } from './bf6';

export type GateOrder = {
  orderId: number;
  /** 申込者の名前(受付で名乗る人) */
  buyerName: string;
  /** この申込に含まれる出場者のダンサーネーム(エントリーと同時購入のとき) */
  people: string[];
  adult: number;
  child: number;
  /** 支払い済みか。当日現金をどこかで受け取っていれば true */
  paid: boolean;
  /** 未払いの額。支払い済みなら0 */
  amountDue: number;
  breakdown: CashLine[];
  /** 渡したリストバンドの数 */
  handed: number;
  /**
   * 検索用の文字列。電話番号は下4桁だけを入れる(画面側に番号を丸ごと持たせない)。
   * 表示には使わない。
   */
  searchText: string;
  /** 名前順の並びの鍵。出場者の本名カタカナがあればその読み(ひらがな)、無ければ申込者の名前 */
  sortKey: string;
};

export function ticketCount(o: Pick<GateOrder, 'adult' | 'child'>): number {
  return o.adult + o.child;
}

export type GateTotals = {
  orders: number;
  tickets: number;
  handed: number;
  remainingTickets: number;
  unpaidOrders: number;
  /** 全員ぶん渡し終わった申込 */
  doneOrders: number;
};

export function gateTotals(rows: GateOrder[]): GateTotals {
  let tickets = 0;
  let handed = 0;
  let unpaidOrders = 0;
  let doneOrders = 0;
  for (const r of rows) {
    const t = ticketCount(r);
    tickets += t;
    handed += Math.min(r.handed, t);
    if (!r.paid) unpaidOrders += 1;
    if (r.handed >= t) doneOrders += 1;
  }
  return { orders: rows.length, tickets, handed, remainingTickets: tickets - handed, unpaidOrders, doneOrders };
}

/** 全角→半角、カタカナ→ひらがな、空白除去、小文字化。 */
function normalize(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function buildGateSearchText(p: {
  buyerName: string;
  people: string[];
  /** 出場者の本名カタカナとダンサーネームの読み。名字でもダンサーネームでも、ひらがなで探せる */
  kana: string[];
  phone: string;
}): string {
  const digits = p.phone.replace(/\D/g, '');
  const tail = digits.length >= 4 ? digits.slice(-4) : '';
  return [p.buyerName, ...p.people, ...p.kana, tail].map(normalize).join('|');
}

export function matchesGateQuery(o: GateOrder, q: string): boolean {
  const k = normalize(q);
  if (!k) return true;
  // 数字だけの検索は電話番号の下4桁との完全一致に限る(途中の数字で当たらないように)
  if (/^\d+$/.test(k)) return o.searchText.split('|').includes(k);
  return o.searchText.includes(k);
}

/**
 * 名前順の鍵。申込者の名前は漢字しか持っていないので、そのまま並べても読みの順にならない。
 * 出場者の「本名(カタカナ)」(親子で名字が同じ)をひらがなにして使う(TARO 2026-09-11「名前でソート」)。
 * ⚠️ 「ダンサーネームのフリガナ」はMCが呼ぶ読み(ヒマリ等)で名字ではないので使わない。
 */
export function gateSortKey(p: { buyerName: string; realNameKana: string[] }): string {
  const k = p.realNameKana.find((x) => x.trim());
  return normalize(k ?? p.buyerName);
}

const HAS_READING = /^[ぁ-ゖー]/;

/** 名前(読み)の順。読みの無い漢字だけの行は、読みのある行の後ろにまとめる。 */
export function sortGateOrders(rows: GateOrder[]): GateOrder[] {
  return [...rows].sort((a, b) => {
    const ar = HAS_READING.test(a.sortKey) ? 0 : 1;
    const br = HAS_READING.test(b.sortKey) ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.sortKey.localeCompare(b.sortKey, 'ja');
  });
}

export type GateTab = 'todo' | 'done' | 'all';

/** まだ入場していない = 全員ぶん渡し終わっていない。渡し終わると「まだ」から消える(TARO 2026-09-11)。 */
export function filterGateTab(rows: GateOrder[], tab: GateTab): GateOrder[] {
  if (tab === 'all') return rows;
  return rows.filter((r) => (r.handed >= ticketCount(r)) === (tab === 'done'));
}

export function gateTabCounts(rows: GateOrder[]): Record<GateTab, number> {
  const done = filterGateTab(rows, 'done').length;
  return { todo: rows.length - done, done, all: rows.length };
}

export function clampHanded(n: number, tickets: number): number {
  return Math.max(0, Math.min(tickets, Math.trunc(n)));
}

// ───────── 当日券(予約なしで来たお客さん) ─────────
// 入場受付の画面の中で、その場の現金で売って数える(TARO 2026-09-11)。

export type WalkinSale = {
  id: number;
  adult: number;
  child: number;
  amount: number;
  soldBy: string;
  createdAt: string;
};

/** 1回で売れる上限。押し間違いで桁が増えるのを防ぐ。 */
export const WALKIN_MAX_PER_SALE = 20;

/** 大人は当日料金、小学生は小学生料金。 */
export function walkinAmount(q: { adult: number; child: number }, pricing: Bf6Pricing): number {
  return (
    q.adult * calcTicketUnitPrice('ticket_adult', 'onsite', pricing) +
    q.child * calcTicketUnitPrice('ticket_child', 'onsite', pricing)
  );
}

/** 問題があればエラー文、無ければ null。 */
export function validateWalkin(q: { adult: number; child: number }): string | null {
  for (const n of [q.adult, q.child]) {
    if (!Number.isInteger(n) || n < 0 || n > WALKIN_MAX_PER_SALE) {
      return `枚数は0〜${WALKIN_MAX_PER_SALE}枚で指定してください`;
    }
  }
  if (q.adult + q.child === 0) return '1枚以上にしてください';
  return null;
}

export function walkinTotals(sales: WalkinSale[]): { sales: number; adult: number; child: number; amount: number } {
  return sales.reduce(
    (t, s) => ({ sales: t.sales + 1, adult: t.adult + s.adult, child: t.child + s.child, amount: t.amount + s.amount }),
    { sales: 0, adult: 0, child: 0, amount: 0 }
  );
}
