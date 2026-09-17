// BF6 当日オペのメニュー。スタッフはこのURLだけをホーム画面に追加すればよい。
//
// ⚠️ 数字は「あと何人 / あといくら」を主役にする。「39 / 45」のような分数は
//    当日その場で逆に読まれる(TARO実機 2026-09-16)。
import Link from 'next/link';
import { Spinner } from './CrewLink';
import { CREW_TASKS } from '@/lib/bf6Crew';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
import { listBf6Qualifiers } from '@/lib/bf6QualifierDb';
import { listBf6CashOrders } from '@/lib/bf6CashDb';
import { cashTotals } from '@/lib/bf6Cash';
import { listBf6GateOrders } from '@/lib/bf6GateDb';
import { gateTotals } from '@/lib/bf6Gate';
import { entryReceptionSummary, photoSummary } from '@/lib/bf6CrewSummary';

export const dynamic = 'force-dynamic';

/** 残っている数を大きく、済んだぶんを小さく添える。 */
function Remaining({ n, unit }: { n: number; unit: string }) {
  if (n <= 0) return <p className="mt-0.5 text-2xl font-black text-brand-600">ぜんぶ完了</p>;
  return (
    <p className="mt-0.5 text-2xl font-black tabular-nums text-navy-900">
      <span className="text-base font-bold text-neutral-500">あと </span>
      {n}
      <span className="text-base font-bold text-neutral-500"> {unit}</span>
    </p>
  );
}

export default async function CrewHomePage() {
  const [entrants, photoIds, qualifiers, cashOrders, gateOrders] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
    listBf6Qualifiers(),
    listBf6CashOrders(),
    listBf6GateOrders(),
  ]);
  const cash = cashTotals(cashOrders);
  const gate = gateTotals(gateOrders);
  const reception = entryReceptionSummary(entrants);
  const photos = photoSummary(entrants, photoIds, qualifiers);

  return (
    <div className="mx-auto max-w-xl p-4">
      <header className="pt-4">
        <p className="text-xs font-black tracking-[0.2em] text-brand-600">BOOMER&apos;S FIGHT!!! vol.6</p>
        <h1 className="mt-1 text-2xl font-black text-navy-900">当日オペ</h1>
        <p className="mt-1 text-sm text-neutral-500">2026.9.26(土) SSM 9階ホール</p>
      </header>

      {/* ⚠️ 「数字を見るところ」と「押すところ」を見た目で分ける。混ざっていると
             どこがボタンか分からない(TARO実機 2026-09-17)。
             数字=白いカード・2列 / メニュー=色の付いたボタン。 */}
      <p className="mt-5 text-xs font-black tracking-[0.2em] text-neutral-500">いまの数字</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-sand-200 bg-white p-3">
          <p className="text-[11px] font-bold leading-tight text-neutral-500">バトルエントリー受付</p>
          <Remaining n={reception.remaining} unit="人" />
          <p className="mt-0.5 text-[11px] font-bold text-neutral-400">
            {reception.total}人中 {reception.done}人受付済み
          </p>
        </div>

        <div className="rounded-xl border border-sand-200 bg-white p-3">
          <p className="text-[11px] font-bold leading-tight text-neutral-500">写真撮影</p>
          <div className="mt-1 divide-y divide-sand-200">
            {photos.map((d) => (
              <div key={d.division} className="flex items-baseline justify-between gap-1 py-1">
                <p className={`text-[11px] font-black ${d.waiting ? 'text-neutral-400' : 'text-navy-900'}`}>
                  {d.label}
                </p>
                {d.waiting ? (
                  <p className="shrink-0 text-right text-[11px] font-bold text-neutral-400">
                    <span className="tabular-nums">{d.total}</span>人・予選後
                  </p>
                ) : d.remaining <= 0 ? (
                  <p className="shrink-0 text-[11px] font-black text-brand-600">完了</p>
                ) : (
                  <p className="shrink-0 text-right text-base font-black tabular-nums text-navy-900">
                    <span className="text-[10px] font-bold text-neutral-500">あと </span>
                    {d.remaining}
                    <span className="text-[10px] font-bold text-neutral-500">/{d.total}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        {cash.orders > 0 && (
          <div className="rounded-xl border border-sand-200 bg-white p-3">
            <p className="text-[11px] font-bold leading-tight text-neutral-500">当日現金(未集金)</p>
            {cash.remainingYen <= 0 ? (
              <p className="mt-0.5 text-xl font-black text-brand-600">ぜんぶ集金済み</p>
            ) : (
              <p className="mt-0.5 text-xl font-black tabular-nums text-navy-900">
                <span className="text-sm font-bold text-neutral-500">あと </span>
                ¥{cash.remainingYen.toLocaleString()}
              </p>
            )}
            <p className="mt-0.5 text-[11px] font-bold text-neutral-400">
              {cash.orders}件中 {cash.collectedOrders}件 集金済み
            </p>
          </div>
        )}

        {gate.tickets > 0 && (
          <div className="rounded-xl border border-sand-200 bg-white p-3">
            <p className="text-[11px] font-bold leading-tight text-neutral-500">観覧のお客さんの入場</p>
            <Remaining n={gate.remainingTickets} unit="人" />
            <p className="mt-0.5 text-[11px] font-bold text-neutral-400">
              {gate.tickets}人中 {gate.handed}人 入場済み
            </p>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs font-black tracking-[0.2em] text-neutral-500">メニュー</p>
      <nav className="mt-2 space-y-2.5">
        {CREW_TASKS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="block rounded-2xl bg-brand-600 p-4 shadow-sm transition active:scale-[0.98] active:bg-brand-700 active:shadow-none"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-black text-white">{t.title}</p>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-bold text-white/80">{t.when}</span>
                {/* 押したことが見た目で分かるようにする(TARO実機 2026-09-16) */}
                <Spinner />
                <span className="text-xl font-black text-white/70">›</span>
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-white/85">{t.desc}</p>
          </Link>
        ))}
      </nav>

      <p className="mt-6 rounded-xl bg-sand-100 p-3 text-xs leading-relaxed text-neutral-600">
        この画面はBF6の当日作業だけができます。返金・キャンセル・売上などは本部の管理画面から
        TAROが行います。困ったらTAROに声をかけてください。
      </p>

      <form action="/api/bf6/crew/logout" method="post" className="mt-4">
        <button className="w-full rounded-xl border border-sand-300 py-2.5 text-sm font-bold text-neutral-500">
          ログアウト
        </button>
      </form>
    </div>
  );
}
