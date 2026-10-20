// スタッフ: vol.7 のエントリー・観覧チケットの申込一覧。/staff/* 配下なのでproxy認証で保護(規約4.5)。
// 作りはvol.6のダッシュボード(/staff/bf6)の集計部分と同じ。編集・返金の操作は受付が始まってから足す。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { BF6_DIVISIONS, bf6DivisionLabel } from '@/lib/bf6';
import { formatBf7ReceiptNo, formatJpDate, isBf7EntryAccepting, isBf7TicketAccepting } from '@/lib/bf7Entry';
import { calcBf7Remaining, getBf7Settings, getBf7Usage, listBf7OrdersStaff } from '@/lib/bf7EntryDb';
import { isAuthorizedServer } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

const STATUS_LABEL: Record<string, string> = {
  paid: 'カード済',
  cash_due: '当日現金',
  pending: '決済待ち',
  expired: '期限切れ',
  canceled: 'キャンセル',
  refunded: '返金済',
};

export default async function StaffBf7OrdersPage() {
  // proxyはcookieの有無しか見ないため、個人情報を出す前にセッションを本検証する(規約4.5)
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const [settings, usage, orders] = await Promise.all([getBf7Settings(), getBf7Usage(), listBf7OrdersStaff()]);
  const remaining = calcBf7Remaining(settings, usage);
  const entryAccepting = isBf7EntryAccepting(settings);
  const ticketAccepting = isBf7TicketAccepting(settings);

  const confirmed = orders.filter((o) => ['paid', 'cash_due'].includes(o.paymentStatus));
  const paidTotal = confirmed.filter((o) => o.paymentStatus === 'paid').reduce((s, o) => s + o.amountTotal, 0);
  const cashDueTotal = confirmed.filter((o) => o.paymentStatus === 'cash_due').reduce((s, o) => s + o.amountTotal, 0);
  const entryCount = confirmed.flatMap((o) => o.items).filter((i) => i.itemType === 'entry').length;
  const ticketCount = confirmed
    .flatMap((o) => o.items)
    .filter((i) => i.itemType.startsWith('ticket_'))
    .reduce((s, i) => s + i.qty, 0);

  return (
    <div>
      <StaffPageHeader
        title="BF7 申込一覧"
        description={`vol.7(2027/1/30)のエントリー・観覧チケット / エントリー${entryAccepting ? '受付中' : '受付前・停止中'}(${formatJpDate(settings.entryStart)}〜${formatJpDate(settings.entryDeadline)})・観覧${ticketAccepting ? '販売中' : '販売前・停止中'}`}
        backHref="/staff/bf7"
        backLabel="ウェイトリスト"
        rightExtra={
          <Link href="/bf7/entry" target="_blank" className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
            申込ページを見る ↗
          </Link>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Summary label="出場者(確定)" value={`${entryCount}人`} />
          <Summary label="観覧チケット(確定)" value={`${ticketCount}枚`} note={`残り${remaining.tickets}枚`} />
          <Summary label="カード入金済み" value={yen(paidTotal)} />
          <Summary label="当日現金(未収)" value={yen(cashDueTotal)} />
        </section>

        <section className="grid grid-cols-3 gap-3">
          {BF6_DIVISIONS.map((d) => (
            <div key={d.key} className="rounded-xl border border-sand-200 bg-white p-3">
              <p className="text-xs font-bold text-neutral-500">{d.label}</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-navy-800">
                {settings.capacity[d.key] - remaining.divisions[d.key]}
                <span className="text-xs text-neutral-500"> / {settings.capacity[d.key]}</span>
              </p>
            </div>
          ))}
        </section>

        {orders.length === 0 ? (
          <p className="rounded-xl border border-sand-200 bg-white p-6 text-sm font-bold text-neutral-500">
            まだ申込はありません。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-sand-200 bg-white">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-sand-100 text-xs text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">受付番号</th>
                  <th className="px-3 py-2 text-left font-bold">状態</th>
                  <th className="px-3 py-2 text-left font-bold">申込者</th>
                  <th className="px-3 py-2 text-left font-bold">内容</th>
                  <th className="px-3 py-2 text-right font-bold">金額</th>
                  <th className="px-3 py-2 text-left font-bold">申込日時</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.orderId} className="border-t border-sand-200 align-top text-navy-900">
                    <td className="px-3 py-2 font-bold tabular-nums">{formatBf7ReceiptNo(o.orderId)}</td>
                    <td className="px-3 py-2 text-neutral-700">{STATUS_LABEL[o.paymentStatus] ?? o.paymentStatus}</td>
                    <td className="px-3 py-2">
                      <p className="font-bold">{o.buyerName}</p>
                      <p className="text-xs text-neutral-500">{o.email} / {o.phone}</p>
                    </td>
                    <td className="px-3 py-2 text-neutral-700">
                      {o.items.map((i, k) =>
                        i.itemType === 'entry' ? (
                          <p key={k}>
                            {i.dancerName}({i.divisions.map(bf6DivisionLabel).join('・')})
                            {i.instagram && <span className="text-xs text-neutral-500"> {i.instagram}</span>}
                          </p>
                        ) : (
                          <p key={k}>
                            {i.itemType === 'ticket_adult' ? '観覧 大人' : i.itemType === 'ticket_child' ? '観覧 小学生' : i.itemType} × {i.qty}
                          </p>
                        )
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{yen(o.amountTotal)}</td>
                    <td className="px-3 py-2 text-xs tabular-nums text-neutral-500">{o.createdAt.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Summary({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <p className="text-xs font-bold text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-navy-800">{value}</p>
      {note && <p className="text-xs text-neutral-500">{note}</p>}
    </div>
  );
}
