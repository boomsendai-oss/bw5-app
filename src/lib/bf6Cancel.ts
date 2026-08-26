// BF6のキャンセル判定(純ロジック・DBに触らない)。
//
// なぜ切り出すか: キャンセルは「枠を空ける」「返金する」の2つが必ずセットで、
// どちらかを忘れると当日トーナメントに欠員が出たり、返金漏れが起きる。
// 判定をここに集約して、DB層・画面の両方が同じ答えを見るようにする。

/** この状態になったら枠(抽選・受付)を手放す。 */
export const CANCEL_STATUSES = ['canceled', 'refunded'] as const;

export type RefundKind =
  /** 返金が必要でまだ済んでいない */
  | 'due'
  /** 返金済み */
  | 'done'
  /** 返金の必要がない(当日現金・無料枠・そもそも未キャンセル) */
  | 'none';

export interface RefundState {
  kind: RefundKind;
  /** 返金すべき金額。kind='due' のときだけ0より大きい。 */
  amount: number;
}

/**
 * 抽選枠・受付を解放すべき状態か。
 * キャンセル/返金済みだけが該当する。expired は枠を持っていないので対象外。
 */
export function requiresSlotRelease(status: string): boolean {
  return (CANCEL_STATUSES as readonly string[]).includes(status);
}

/** 返金の要否。事前カード決済でお金を受け取っている場合だけ 'due' になる。 */
export function refundState(input: {
  payMethod: 'prepaid' | 'onsite';
  paymentStatus: string;
  amountTotal: number;
}): RefundState {
  const { payMethod, paymentStatus, amountTotal } = input;
  if (paymentStatus === 'refunded') return { kind: 'done', amount: 0 };
  if (paymentStatus !== 'canceled') return { kind: 'none', amount: 0 };
  // 当日現金はまだ受け取っていないので返すものがない
  if (payMethod !== 'prepaid') return { kind: 'none', amount: 0 };
  // SSM学生枠など¥0の申込は返金対象にしない
  if (amountTotal <= 0) return { kind: 'none', amount: 0 };
  return { kind: 'due', amount: amountTotal };
}
