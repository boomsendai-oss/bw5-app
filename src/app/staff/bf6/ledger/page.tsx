// スタッフ: BF6の収支台帳。/staff/* 配下のためproxy認証で保護(規約4.5)。
// アプリのDBに出てこない固定費とアプリ外の現金をここで管理する。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getBf6Finance } from '@/lib/eventLedgerDb';
import LedgerEditor from './LedgerEditor';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default async function StaffBf6LedgerPage() {
  const { finance, ledger } = await getBf6Finance();

  return (
    <div>
      <StaffPageHeader
        title="収支台帳"
        description="固定費とアプリ外の入金(現金集金など)を記録します。エントリー・チケットの売上はアプリの実データから自動で入ります"
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-4xl space-y-6 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="売上 合計" value={yen(finance.revenue.total)} />
          <Card label="支出 合計" value={yen(finance.cost.total)} />
          <Card
            label="損益"
            value={`${finance.profit >= 0 ? '+' : ''}${yen(finance.profit)}`}
            strong={finance.profit >= 0}
          />
          <Card label="未回収" value={yen(finance.receivable)} />
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">売上の内訳</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Row k="アプリ経由(エントリー・チケット・配信)" v={yen(finance.revenue.app)} />
            <Row k="アプリ外(下の台帳の入金)" v={yen(finance.revenue.offline)} />
            <Row k="うち回収済み" v={yen(finance.collected)} muted />
            <Row k="うち未回収(当日現金など)" v={yen(finance.receivable)} muted />
          </dl>
          <h2 className="mt-4 text-sm font-bold text-navy-800">支出の内訳</h2>
          <dl className="mt-2 space-y-1 text-sm">
            <Row k="台帳の支出" v={yen(finance.cost.ledger)} />
            <Row k={`決済手数料(カード入金の3.6%)`} v={yen(finance.cost.stripeFee)} muted />
            <Row k="うち支払い済み" v={yen(finance.cost.paid)} muted />
            <Row k="うち未払い" v={yen(finance.cost.unpaid)} muted />
          </dl>
        </section>

        <LedgerEditor entries={ledger} />

        <p className="text-xs leading-relaxed text-neutral-500">
          他のセッションからは <code className="rounded bg-sand-100 px-1">node scripts/event-summary.mjs bf6</code> で
          同じ数字を読めます(<code className="rounded bg-sand-100 px-1">--json</code> で機械可読)。
        </p>
      </div>
    </div>
  );
}

function Card({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <p className="text-xs font-bold text-neutral-500">{label}</p>
      <p className={`mt-1 text-xl font-bold ${strong ? 'text-brand-700' : 'text-navy-800'}`}>{value}</p>
    </div>
  );
}

function Row({ k, v, muted }: { k: string; v: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-neutral-500' : 'text-navy-800'}`}>
      <dt>{k}</dt>
      <dd className="font-bold tabular-nums">{v}</dd>
    </div>
  );
}
