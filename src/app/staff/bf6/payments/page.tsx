// スタッフ: Stripe突合ビュー。Webhook記録(bf_payments=決済の正本)と注文を照合し、
// 金額ズレ・注文不明の決済を検知する。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { formatReceiptNo } from '@/lib/bf6';
import { listBf6PaymentsStaff } from '@/lib/bf6Db';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default async function StaffBf6PaymentsPage() {
  const payments = await listBf6PaymentsStaff();
  const issues = payments.filter(
    (p) => p.orderId == null || (p.orderAmount != null && p.amount !== p.orderAmount)
  );

  return (
    <div>
      <StaffPageHeader
        title="Stripe突合"
        description={`Webhook受信 ${payments.length}件 / 要確認 ${issues.length}件`}
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-6xl space-y-4 p-4">
        {issues.length > 0 && (
          <div className="rounded-xl border-2 border-red-300 bg-red-50 p-3 text-sm font-bold text-red-700">
            ⚠ 金額ズレまたは注文不明の決済が{issues.length}件あります(下の表の赤い行)。Stripeダッシュボードと照合してください。
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 bg-sand-50 text-left text-xs text-neutral-500">
                <th className="px-3 py-2">受信日時</th>
                <th className="px-3 py-2">イベント</th>
                <th className="px-3 py-2">注文</th>
                <th className="px-3 py-2">Stripe金額</th>
                <th className="px-3 py-2">注文金額</th>
                <th className="px-3 py-2">注文状態</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const bad = p.orderId == null || (p.orderAmount != null && p.amount !== p.orderAmount);
                return (
                  <tr key={p.id} className={`border-b border-sand-100 ${bad ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-2 text-xs text-neutral-500">{p.createdAt.slice(0, 16).replace('T', ' ')}</td>
                    <td className="px-3 py-2 text-xs">{p.eventType}</td>
                    <td className="px-3 py-2 font-mono font-bold text-navy-800">
                      {p.orderId != null ? formatReceiptNo(p.orderId) : '不明'}
                    </td>
                    <td className="px-3 py-2">{yen(p.amount)}</td>
                    <td className="px-3 py-2">{p.orderAmount != null ? yen(p.orderAmount) : '—'}</td>
                    <td className="px-3 py-2 text-xs">{p.orderStatus || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {payments.length === 0 && (
            <p className="p-4 text-sm text-neutral-500">まだWebhookの受信記録がありません(カード決済が1件も完了していない状態)。</p>
          )}
        </div>
        <p className="text-xs text-neutral-500">
          この表はStripeからのWebhook通知(checkout.session.completed)の受信ログです。同一イベントの再送は自動で無視されます。
        </p>
      </div>
    </div>
  );
}
