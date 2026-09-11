// 観覧のお客さんの入場受付。純ロジック・DBに触らない。
//
// 14:30の開場で観覧チケットのお客さんを15分で入れる(TARO 2026-09-11)。
// スタッフが名前を聞いて一覧から探し、支払い済みならリストバンドを渡して「渡した」を押す。
// 当日現金でまだ払っていなければ、その場で受け取ってから渡す。
// 家族がばらばらに来ることがあるので、渡した数は申込ごとに枚数で持つ。
import type { CashLine } from './bf6Cash';

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
  /** 出場者の本名フリガナ。親子で名字が同じなので、名字をひらがなで言われても探せる */
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

/** まだ渡し終わっていない申込を先に。同じ状態どうしは名前順。 */
export function sortGateOrders(rows: GateOrder[]): GateOrder[] {
  return [...rows].sort((a, b) => {
    const ad = a.handed >= ticketCount(a) ? 1 : 0;
    const bd = b.handed >= ticketCount(b) ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return a.buyerName.localeCompare(b.buyerName, 'ja');
  });
}

export function clampHanded(n: number, tickets: number): number {
  return Math.max(0, Math.min(tickets, Math.trunc(n)));
}
