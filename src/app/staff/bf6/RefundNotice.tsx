// キャンセル済み注文の返金状態を出す。返金そのものはStripe管理画面で人が行う。
import { refundState } from '@/lib/bf6Cancel';
import type { Bf6PayMethod } from '@/lib/bf6';

export default function RefundNotice({
  payMethod,
  paymentStatus,
  amountTotal,
  paymentIntentId,
}: {
  payMethod: Bf6PayMethod;
  paymentStatus: string;
  amountTotal: number;
  paymentIntentId: string;
}) {
  const r = refundState({ payMethod, paymentStatus, amountTotal });
  if (r.kind === 'none') return null;

  if (r.kind === 'done') {
    return (
      <p className="mt-2 rounded-lg bg-neutral-100 px-3 py-2 text-xs text-neutral-500">
        返金済みとして記録されています。
      </p>
    );
  }

  return (
    <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
      <p className="text-sm font-bold text-red-700">
        返金が未処理です — ¥{r.amount.toLocaleString()}
      </p>
      <p className="mt-1 text-xs text-red-700">
        Stripeの管理画面で返金してから、下の「返金済みにする」を押してください。
      </p>
      {paymentIntentId ? (
        <p className="mt-1 font-mono text-xs break-all text-red-800">{paymentIntentId}</p>
      ) : (
        <p className="mt-1 text-xs text-red-600">
          決済IDが記録されていません。Stripeでメールアドレスから検索してください。
        </p>
      )}
    </div>
  );
}
