// HIRO ワークショップの銀行振込を、GMOあおぞらの入出金明細CSV(statement-201-*.csv)と照合する純関数。
// 振込名義の前に受付番号(例: WS001)を付けてもらっている(buildBf7WsEmail の案内)。
// 自動で入金済みにするのは「受付番号が書いてあり、その申込が振込待ちで、金額がぴったり」のときだけ。
// それ以外(金額違い・受付番号なしで名前だけ合う 等)は人が確かめる一覧に回す。

export type BankDeposit = {
  /** 明細の日付(CSVのまま) */
  date: string;
  /** 摘要(例: "振込  WS001ﾔﾏﾀﾞ ﾊﾅｺ") */
  description: string;
  /** 入金金額(円) */
  amount: number;
};

export type WsTransferOrder = {
  id: number;
  kana: string;
  amountTotal: number;
  payMethod: 'prepaid' | 'transfer';
  paymentStatus: string;
};

export type WsTransferMatch =
  | { kind: 'auto'; orderId: number; deposit: BankDeposit }
  | { kind: 'already_paid'; orderId: number; deposit: BankDeposit }
  | { kind: 'review'; orderId: number | null; deposit: BankDeposit; reason: string };

/** 半角カナ・全角英数・空白のゆれをそろえる(比較用) */
export function normalizeBankText(s: string): string {
  return (s || '').normalize('NFKC').toUpperCase().replace(/[\s　]+/g, '');
}

/** 摘要から受付番号を読む。WS001 / WS-001 / WS 1 などを受け付ける */
export function readWsOrderNumber(description: string): number | null {
  const m = normalizeBankText(description).match(/WS-?0*(\d{1,4})/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

/** 摘要が振込の入金か(ATM・利息・デビットの取消などは除く) */
function isTransferDeposit(d: BankDeposit): boolean {
  return d.amount > 0 && normalizeBankText(d.description).startsWith('振込');
}

export function matchBf7WsTransfers(deposits: BankDeposit[], orders: WsTransferOrder[]): WsTransferMatch[] {
  const byId = new Map(orders.map((o) => [o.id, o]));
  const transferDue = orders.filter((o) => o.payMethod === 'transfer' && o.paymentStatus === 'transfer_due');
  const used = new Set<number>();
  const out: WsTransferMatch[] = [];

  for (const d of deposits) {
    if (!isTransferDeposit(d)) continue;
    const no = readWsOrderNumber(d.description);

    if (no !== null) {
      const o = byId.get(no);
      if (!o || o.payMethod !== 'transfer') {
        out.push({ kind: 'review', orderId: no, deposit: d, reason: '受付番号に当たる振込の申込がありません' });
      } else if (o.paymentStatus === 'paid') {
        out.push({ kind: 'already_paid', orderId: o.id, deposit: d });
      } else if (o.paymentStatus !== 'transfer_due') {
        out.push({ kind: 'review', orderId: o.id, deposit: d, reason: `申込の状態が「${o.paymentStatus}」です(取消済みなど)` });
      } else if (used.has(o.id)) {
        out.push({ kind: 'review', orderId: o.id, deposit: d, reason: '同じ受付番号の入金が2回あります' });
      } else if (d.amount !== o.amountTotal) {
        out.push({ kind: 'review', orderId: o.id, deposit: d, reason: `金額が違います(入金¥${d.amount.toLocaleString()} / 申込¥${o.amountTotal.toLocaleString()})` });
      } else {
        used.add(o.id);
        out.push({ kind: 'auto', orderId: o.id, deposit: d });
      }
      continue;
    }

    // 受付番号が書かれていない入金: 名前(カナ)と金額が合う振込待ちの申込があれば、確かめる一覧にだけ出す
    const desc = normalizeBankText(d.description);
    const cand = transferDue.find((o) => !used.has(o.id) && o.amountTotal === d.amount && normalizeBankText(o.kana).length >= 2 && desc.includes(normalizeBankText(o.kana)));
    if (cand) {
      out.push({ kind: 'review', orderId: cand.id, deposit: d, reason: '受付番号はありませんが、名前と金額が合います' });
    }
  }
  return out;
}
