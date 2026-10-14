// スタッフ: クリパ2026の当日精算と収支。/staff/* 配下のためproxy認証で保護(規約4.5)。
// 当日の現金は会場キャッシャーが受け取り、会場費と相殺した差額をBOOMと精算する。
// 精算結果と支出は event_ledger(event_key='xmas2026')に記録する。
import StaffPageHeader from '@/components/StaffPageHeader';
import { PARTY_EVENT_KEY, STRIPE_FEE_RATE, signedYen, summarizePartyOrders, yen } from '@/lib/party';
import { getPartySettings, listPartyOrdersStaff } from '@/lib/partyDb';
import { listLedger } from '@/lib/eventLedgerDb';
import SettlementForm from './SettlementForm';
import CostEditor from './CostEditor';

export const dynamic = 'force-dynamic';

export default async function StaffXmasSettlementPage() {
  const [orders, s, ledger] = await Promise.all([
    listPartyOrdersStaff(PARTY_EVENT_KEY),
    getPartySettings(PARTY_EVENT_KEY),
    listLedger(PARTY_EVENT_KEY),
  ]);
  const sum = summarizePartyOrders(orders);
  const cashIncome = ledger.filter((e) => e.kind === 'income').reduce((a, e) => a + e.amount, 0);
  const costs = ledger.filter((e) => e.kind === 'cost');
  const costTotal = costs.reduce((a, e) => a + e.amount, 0);
  const stripeFee = Math.round(sum.cardPaid * STRIPE_FEE_RATE);
  const settled = ledger.some((e) => e.category === 'キャッシャー回収');
  const profit = sum.cardPaid - stripeFee + cashIncome - costTotal;

  return (
    <div>
      <StaffPageHeader
        title="クリパ2026 精算・収支"
        description="終了後にキャッシャーの現金を入力すると、会場費との相殺と収支が出ます"
        backHref="/staff/xmas"
        backLabel="クリパ2026"
      />
      <div className="mx-auto max-w-3xl space-y-6 p-4">
        <SettlementForm expectedCash={sum.cashDue} doorPrice={s.doorPrice} venueFee={s.venueFee} />

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">収支{settled ? '' : '(精算前の見込み)'}</h2>
          <dl className="mt-2 space-y-1 text-sm text-navy-800">
            <Line k="カード前売・出演(支払済み)" v={yen(sum.cardPaid)} />
            <Line k={`決済手数料(${(STRIPE_FEE_RATE * 100).toFixed(1)}%)`} v={yen(-stripeFee)} muted />
            <Line k="キャッシャー回収の現金" v={settled ? yen(cashIncome) : `未精算(予約分の見込み ${yen(sum.cashDue)})`} />
            <Line k="支出(会場費・プレゼントなど)" v={yen(-costTotal)} />
            <div className="mt-2 border-t border-sand-200 pt-2">
              <Line k="損益" v={signedYen(profit)} strong />
            </div>
          </dl>
        </section>

        <CostEditor entries={costs.map((e) => ({ id: e.id, label: e.label, amount: e.amount, note: e.note, category: e.category }))} />
      </div>
    </div>
  );
}

function Line({ k, v, muted, strong }: { k: string; v: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${muted ? 'text-neutral-500' : ''} ${strong ? 'text-base font-bold' : ''}`}>
      <dt>{k}</dt>
      <dd className="text-right">{v}</dd>
    </div>
  );
}
