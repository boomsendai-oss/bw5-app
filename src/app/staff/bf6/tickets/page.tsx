// スタッフ: BF6観覧チケット一覧。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { formatReceiptNo } from '@/lib/bf6';
import { listBf6OrdersStaff } from '@/lib/bf6Db';
import StatusButtons from '../StatusButtons';
import { refundState } from '@/lib/bf6Cancel';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default async function StaffBf6TicketsPage() {
  const orders = (await listBf6OrdersStaff()).filter((o) =>
    o.items.some((i) => i.itemType.startsWith('ticket_'))
  );
  const confirmed = orders.filter((o) => ['paid', 'cash_due'].includes(o.paymentStatus));
  const adultTotal = confirmed
    .flatMap((o) => o.items)
    .filter((i) => i.itemType === 'ticket_adult')
    .reduce((s, i) => s + i.qty, 0);
  const childTotal = confirmed
    .flatMap((o) => o.items)
    .filter((i) => i.itemType === 'ticket_child')
    .reduce((s, i) => s + i.qty, 0);

  return (
    <div>
      <StaffPageHeader
        title="観覧チケット一覧"
        description={`確定: 大人${adultTotal}枚・小学生${childTotal}枚(エントリー同時購入も含む)`}
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-6xl p-4">
        <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-sand-200 bg-sand-50 text-left text-xs text-neutral-500">
                <th className="px-3 py-2">受付番号</th>
                <th className="px-3 py-2">購入者</th>
                <th className="px-3 py-2">連絡先</th>
                <th className="px-3 py-2">大人</th>
                <th className="px-3 py-2">小学生</th>
                <th className="px-3 py-2">金額(注文全体)</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const adult = o.items.find((i) => i.itemType === 'ticket_adult');
                const child = o.items.find((i) => i.itemType === 'ticket_child');
                return (
                  <tr key={o.orderId} className="border-b border-sand-100">
                    <td className="px-3 py-2 font-mono font-bold text-navy-800">{formatReceiptNo(o.orderId)}</td>
                    <td className="px-3 py-2">{o.buyerName}</td>
                    <td className="px-3 py-2 text-xs text-neutral-500">{o.email}<br />{o.phone}</td>
                    <td className="px-3 py-2">{adult?.qty ?? 0}</td>
                    <td className="px-3 py-2">{child?.qty ?? 0}</td>
                    <td className="px-3 py-2">{yen(o.amountTotal)}</td>
                    <td className="px-3 py-2 text-xs">
                      {o.paymentStatus}
                      {(() => {
                        const r = refundState(o);
                        if (r.kind !== 'due') return null;
                        return (
                          <span className="mt-1 block font-bold text-red-600">
                            要返金 {yen(r.amount)}
                            {o.paymentIntentId && (
                              <span className="block font-mono font-normal break-all text-red-700">{o.paymentIntentId}</span>
                            )}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2"><StatusButtons orderId={o.orderId} current={o.paymentStatus} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 0 && <p className="p-4 text-sm text-neutral-500">まだ観覧チケットの購入がありません。</p>}
        </div>
      </div>
    </div>
  );
}
