// スタッフ: BF6エントリー一覧(PII込み)。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { bf6DivisionLabel, bf6GradeLabel, formatReceiptNo } from '@/lib/bf6';
import { listBf6OrdersStaff, SSM_FREE_NOTE } from '@/lib/bf6Db';
import StatusButtons from '../StatusButtons';
import EntryEditor from '../EntryEditor';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  paid: { label: '入金済み', cls: 'bg-emerald-100 text-emerald-700' },
  cash_due: { label: '当日現金', cls: 'bg-amber-100 text-amber-700' },
  pending: { label: '決済待ち', cls: 'bg-sand-100 text-neutral-500' },
  expired: { label: '期限切れ', cls: 'bg-neutral-100 text-neutral-400' },
  canceled: { label: 'キャンセル', cls: 'bg-red-100 text-red-600' },
  refunded: { label: '返金済み', cls: 'bg-red-100 text-red-600' },
};

export default async function StaffBf6EntriesPage() {
  const orders = (await listBf6OrdersStaff()).filter((o) =>
    o.items.some((i) => i.itemType === 'entry')
  );

  return (
    <div>
      <StaffPageHeader
        title="エントリー一覧"
        description={`${orders.length}件の申込(うちSSM学生枠 ${orders.filter((o) => o.note === SSM_FREE_NOTE).length}件・全ステータス表示)`}
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-6xl space-y-3 p-4">
        {orders.length === 0 && <p className="text-sm text-neutral-500">まだエントリーがありません。</p>}
        {orders.map((o) => {
          const badge = STATUS_BADGE[o.paymentStatus] ?? { label: o.paymentStatus, cls: 'bg-sand-100' };
          const entries = o.items.filter((i) => i.itemType === 'entry');
          const adult = o.items.find((i) => i.itemType === 'ticket_adult');
          const child = o.items.find((i) => i.itemType === 'ticket_child');
          return (
            <div key={o.orderId} className="rounded-xl border border-sand-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-bold text-navy-800">{formatReceiptNo(o.orderId)}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${badge.cls}`}>{badge.label}</span>
                {o.note === SSM_FREE_NOTE && (
                  <span className="rounded-full bg-navy-800 px-2 py-0.5 text-xs font-bold text-white">SSM学生枠(無料)</span>
                )}
                <span className="text-sm font-bold text-navy-800">{yen(o.amountTotal)}</span>
                <span className="text-xs text-neutral-400">{o.createdAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-600">
                申込者: <span className="font-bold text-navy-800">{o.buyerName}</span>
                <span className="ml-2">{o.email}</span>
                <span className="ml-2">{o.phone}</span>
              </p>
              <div className="mt-2 space-y-1">
                {entries.map((e) => (
                  <div key={e.itemId}>
                    <p className="text-sm text-neutral-700">
                      <span className="font-bold text-navy-800">{e.dancerName}</span>
                      <span className="text-neutral-400">({e.dancerKana})</span>
                      <span className="ml-1">{e.performerName}・{bf6GradeLabel(e.grade)}</span>
                      <span className="ml-1 font-bold text-brand-700">{e.divisions.map(bf6DivisionLabel).join('・')}</span>
                      {e.genre && <span className="ml-1 text-neutral-500">{e.genre}</span>}
                      {e.rep && <span className="ml-1 text-neutral-500">REP:{e.rep}</span>}
                      {e.instagram && <span className="ml-1 text-neutral-500">{e.instagram}</span>}
                      <EntryEditor
                        itemId={e.itemId}
                        dancerName={e.dancerName}
                        dancerKana={e.dancerKana}
                        performerName={e.performerName}
                        genre={e.genre}
                        rep={e.rep}
                        instagram={e.instagram}
                      />
                    </p>
                  </div>
                ))}
                {(adult || child) && (
                  <p className="text-xs text-neutral-500">
                    観覧: {adult ? `大人×${adult.qty} ` : ''}{child ? `小学生×${child.qty}` : ''}
                  </p>
                )}
              </div>
              <div className="mt-3 border-t border-sand-100 pt-2">
                <StatusButtons orderId={o.orderId} current={o.paymentStatus} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
