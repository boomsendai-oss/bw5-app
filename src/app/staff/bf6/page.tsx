// スタッフ: BF6ダッシュボード。/staff/* 配下のためproxy認証で保護(規約4.5)。
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';
import { BF6_DIVISIONS } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Settings, getBf6Usage, listBf6OrdersStaff } from '@/lib/bf6Db';
import { getBf6Finance } from '@/lib/eventLedgerDb';
import { listBf6StreamViewers } from '@/lib/bf6StreamDb';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default async function StaffBf6Page() {
  const [settings, usage, orders, { finance }, viewers] = await Promise.all([
    getBf6Settings(),
    getBf6Usage(),
    listBf6OrdersStaff(),
    getBf6Finance(),
    listBf6StreamViewers(),
  ]);
  // 配信を見ている端末の数。押すと誰が見ているかの内訳へ(TARO 2026-09-26)
  const watching = viewers.filter((v) => v.watching).length;
  const remaining = calcBf6Remaining(settings, usage);

  const confirmed = orders.filter((o) => ['paid', 'cash_due'].includes(o.paymentStatus));
  const paidTotal = confirmed
    .filter((o) => o.paymentStatus === 'paid')
    .reduce((s, o) => s + o.amountTotal, 0);
  const cashDueTotal = confirmed
    .filter((o) => o.paymentStatus === 'cash_due')
    .reduce((s, o) => s + o.amountTotal, 0);
  const entryCount = confirmed.flatMap((o) => o.items).filter((i) => i.itemType === 'entry').length;
  const ticketCount = confirmed
    .flatMap((o) => o.items)
    .filter((i) => i.itemType.startsWith('ticket_'))
    .reduce((s, i) => s + i.qty, 0);

  return (
    <div>
      <StaffPageHeader
        title="🔥 BOOMER'S FIGHT vol.6"
        description={`エントリー・観覧・決済の管理 / 受付${settings.entryOpen ? '中' : '停止中'}・${settings.entryDeadline}締切`}
        rightExtra={
          <Link href="/bf6" target="_blank" className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
            公開ページを見る ↗
          </Link>
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="出場者(確定)" value={`${entryCount}人`} />
          <SummaryCard label="観覧チケット(確定)" value={`${ticketCount}枚`} />
          <SummaryCard label="カード入金済み" value={yen(paidTotal)} />
          <SummaryCard label="当日現金(未収)" value={yen(cashDueTotal)} />
          <SummaryCard
            label="配信 接続中"
            value={`${watching}人`}
            note={`配信チケット ${viewers.length}件`}
            href="/staff/bf6/stream"
          />
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-navy-800">収支(アプリ外の現金・固定費を含む)</h2>
            <Link href="/staff/bf6/ledger" className="text-xs font-bold text-brand-700 underline">
              台帳を編集
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-sand-50 p-3 text-center">
              <p className="text-xs font-bold text-neutral-500">売上</p>
              <p className="mt-1 text-xl font-bold text-navy-800">{yen(finance.revenue.total)}</p>
            </div>
            <div className="rounded-lg bg-sand-50 p-3 text-center">
              <p className="text-xs font-bold text-neutral-500">支出</p>
              <p className="mt-1 text-xl font-bold text-navy-800">{yen(finance.cost.total)}</p>
            </div>
            <div className="rounded-lg bg-brand-50 p-3 text-center">
              <p className="text-xs font-bold text-brand-700">損益</p>
              <p className="mt-1 text-xl font-bold text-brand-700">
                {finance.profit >= 0 ? '+' : ''}{yen(finance.profit)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">部門別の埋まり状況</h2>
          <div className="mt-3 grid grid-cols-3 gap-3">
            {BF6_DIVISIONS.map((d) => {
              const used = usage.divisionCounts[d.key];
              const cap = settings.capacity[d.key];
              return (
                <div key={d.key} className="rounded-lg bg-sand-50 p-3 text-center">
                  <p className="text-xs font-bold text-neutral-500">{d.label}</p>
                  <p className="mt-1 text-2xl font-bold text-navy-800">
                    {used}<span className="text-sm text-neutral-400"> / {cap}</span>
                  </p>
                  <p className="text-xs text-brand-600">残り{remaining.divisions[d.key]}枠</p>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-neutral-500">
            観覧残数(定員{settings.hallCapacity} − 出演者 − 販売済): <span className="font-bold text-navy-800">{remaining.tickets}枚</span>
          </p>
        </section>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <NavCard href="/staff/bf6/entries" title="エントリー一覧" note="本名・連絡先・状態変更" />
          <NavCard href="/staff/bf6/tickets" title="観覧一覧" note="観覧のみ購入含む" />
          <NavCard href="/staff/bf6/payments" title="Stripe突合" note="Webhook記録と金額照合" />
          <NavCard href="/staff/bf6/reception" title="当日受付" note="チェックイン+くじ引き" />
          <NavCard href="/staff/bf6/control" title="LED操作卓" note="会場スクリーンの切替" />
          <NavCard href="/staff/bf6/waitlist" title="キャンセル待ち" note="繰り上げ通知を手動で送る" />
          <NavCard href="/staff/bf6/broadcast" title="一斉メール" note="エントリー者へのお知らせ" />
          <NavCard href="/staff/bf6/ledger" title="収支台帳" note="固定費・アプリ外の現金" />
          <NavCard href="/staff/bf6/settings" title="設定" note="定員・料金・受付ON/OFF" />
        </section>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, note, href }: { label: string; value: string; note?: string; href?: string }) {
  const body = (
    <>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-navy-800">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-neutral-400">{note}</p>}
    </>
  );
  // 押せるカードは内訳へ飛ぶ(いまは配信だけ)
  return href ? (
    <Link href={href} className="rounded-xl border border-sand-200 bg-white p-4 hover:border-brand-400">
      {body}
      <p className="mt-1 text-[11px] font-bold text-brand-700">内訳を見る →</p>
    </Link>
  ) : (
    <div className="rounded-xl border border-sand-200 bg-white p-4">{body}</div>
  );
}

function NavCard({ href, title, note }: { href: string; title: string; note: string }) {
  return (
    <Link href={href} className="rounded-xl border border-sand-200 bg-white p-4 hover:border-brand-400">
      <p className="text-sm font-bold text-brand-700">{title} →</p>
      <p className="mt-1 text-xs text-neutral-500">{note}</p>
    </Link>
  );
}
