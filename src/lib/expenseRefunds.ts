// Visaデビットの取消(返金)を経費から打ち消すための純関数。
//
// 背景: 銀行明細では「利用」と「取消」が別行で来る。利用行は経費に計上されるが、
// 取消行は入金なので `経費外(入金)` として無視されており、**返金が経費から引かれていなかった**。
// 実例: 2026-06-19 インスタベース ¥5,775 を当日中に取消 → 6月の経費が¥5,775過大。
//
// マスタの文字列照合では拾えない(インスタベースのパターンは「インスタベ」だが明細は
// 英字 INSTABASE で、あの経費はTAROが画面で手動分類したもの)。
// 取消行は元の取引と **承認番号が同じ** なので、そこで突き合わせる。

/** 摘要から承認番号を取り出す。取れなければ null。 */
export function extractApprovalNo(description: string): string | null {
  const m = (description ?? '').normalize('NFKC').match(/承認番号[:：]?\s*(\d{4,})/);
  return m ? m[1] : null;
}

/**
 * その行が「返金(=経費を打ち消すべき入金)」かどうか。
 *
 * `Visaデビット取消` / `Visaデビット出金取消` … 利用を取り消した = 返金(入金・打ち消す)
 * `Visaデビット入金取消`                      … **返金の取り消し** = 再度の引き落とし。
 *                                               これは出金なので通常の経費側で処理され、
 *                                               ここで返金扱いにすると符号が逆になる。
 */
export function isDebitRefund(description: string, amount: number): boolean {
  const d = (description ?? '').normalize('NFKC');
  if (amount <= 0) return false;              // 返金は必ず入金
  if (d.includes('入金取消')) return false;   // 返金の取り消しは対象外
  return /デビット(出金)?取消/.test(d);
}

export type ChargeRef = {
  /** 元の利用行(bank_transactions.id) */
  txnId: number;
  approvalNo: string;
  category: string;
  subcategory: string | null;
  /** 元の経費の金額(正の値) */
  amount: number;
};

export type RefundRow = { txnId: number; date: string; description: string; amount: number };

export type RefundPlan = {
  refundTxnId: number;
  date: string;
  category: string;
  subcategory: string | null;
  /** 経費に入れる金額。マイナスで打ち消す */
  amount: number;
  description: string;
};

/**
 * 返金行を、承認番号が一致する元の経費に突き合わせる。
 *
 * - 元の経費が見つからない返金は **対象外**(そもそも経費に入っていないので打ち消す必要がない)
 * - 既に打ち消し済みの承認番号はスキップ(冪等)
 * - 返金額が元の経費額を超える場合は元の額までに留める(過剰な打ち消しを防ぐ)
 */
export function planRefunds(
  refunds: readonly RefundRow[],
  charges: ReadonlyMap<string, ChargeRef>,
  alreadyApplied: ReadonlySet<string>
): { plans: RefundPlan[]; unmatched: RefundRow[] } {
  const plans: RefundPlan[] = [];
  const unmatched: RefundRow[] = [];
  const used = new Set<string>(alreadyApplied);

  for (const r of refunds) {
    const no = extractApprovalNo(r.description);
    const charge = no ? charges.get(no) : undefined;
    if (!no || !charge) { unmatched.push(r); continue; }
    if (used.has(no)) continue;
    used.add(no);
    const amount = Math.min(r.amount, charge.amount);
    plans.push({
      refundTxnId: r.txnId,
      date: r.date,
      category: charge.category,
      subcategory: charge.subcategory,
      amount: -amount,
      description: `【返金】承認番号${no} の取消 (元: ${charge.category}/${charge.subcategory ?? '-'} ¥${charge.amount.toLocaleString()})`,
    });
  }
  return { plans, unmatched };
}
