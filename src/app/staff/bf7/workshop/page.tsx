// スタッフ: HIRO ワークショップの申込一覧(会員の照合結果・銀行振込の入金確認・取消)。
// 個人情報を出すので、proxyのcookie確認に加えてセッションを本検証する(規約4.5)。
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { BF7_WORKSHOP } from '@/lib/bf7';
import { bf7WsGate, formatBf7WsDate, yenBf7Ws } from '@/lib/bf7Workshop';
import { listBf7WsOrdersStaff } from '@/lib/bf7WorkshopDb';
import OrderTable from './OrderTable';

export const dynamic = 'force-dynamic';

export default async function StaffBf7WorkshopPage() {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const rows = await listBf7WsOrdersStaff();
  const ws = BF7_WORKSHOP;
  const live = rows.filter((r) => !r.isTest && (r.paymentStatus === 'paid' || r.paymentStatus === 'transfer_due'));
  const first = live.filter((r) => r.first).length;
  const second = live.filter((r) => r.second).length;
  const paid = live.filter((r) => r.paymentStatus === 'paid').reduce((s, r) => s + r.amountTotal, 0);
  const transferDue = live.filter((r) => r.paymentStatus === 'transfer_due').reduce((s, r) => s + r.amountTotal, 0);
  const review = rows.filter((r) => !r.isTest && r.memberCheck === 'review' && r.paymentStatus !== 'expired' && r.paymentStatus !== 'canceled').length;
  const gateLabel = {
    before: `受付開始前(会員先行 ${formatBf7WsDate(ws.memberFrom)}から)`,
    member: `会員の先行受付中(一般 ${formatBf7WsDate(ws.openFrom)}から)`,
    open: '受付中(誰でも)',
    closed: '締切',
  }[bf7WsGate(todayJst())];

  return (
    <div>
      <StaffPageHeader
        title="BF7 HIRO WS 申込"
        description={gateLabel}
        backHref="/staff/bf7"
        backLabel="BF7"
        rightExtra={
          <a href="/bf7/workshop" target="_blank" rel="noreferrer" className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-navy-700 hover:bg-sand-50">
            申込ページ
          </a>
        }
      />
      <div className="mx-auto max-w-6xl space-y-5 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label={ws.classes[0].title} value={`${first} / ${ws.capacity}`} sub="1本目(確定)" />
          <Card label={ws.classes[1].title} value={`${second} / ${ws.capacity}`} sub="2本目(確定)" />
          <Card label="受講料" value={yenBf7Ws(paid + transferDue)} sub={`受取済 ${yenBf7Ws(paid)} / 振込待ち ${yenBf7Ws(transferDue)}`} />
          <Card label="会員の要確認" value={`${review}件`} sub="下の表で判断してください" alert={review > 0} />
        </section>
        <OrderTable rows={rows} today={todayJst()} />
        <p className="text-xs text-neutral-500">
          「会員」と申告した人だけ、名前を会員データと照合しています。在籍中の会員1人にぴったり一致すれば「確認済み」、機械では決められないときは「要確認」です。「要確認」はこの画面を開くたびに最新の会員データで照合し直すので、申込のあとに入会した人も、会員データの同期が済めば自動で「確認済み」になります。照合の結果は申込者には見えません。
        </p>
      </div>
    </div>
  );
}

function Card({ label, value, sub, alert }: { label: string; value: string; sub?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border bg-white p-3 ${alert ? 'border-amber-400' : 'border-sand-200'}`}>
      <p className="text-xs font-bold text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-navy-900">{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}
