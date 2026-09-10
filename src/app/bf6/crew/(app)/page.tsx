// BF6 当日オペのメニュー。スタッフはこのURLだけをホーム画面に追加すればよい。
import Link from 'next/link';
import { CREW_TASKS } from '@/lib/bf6Crew';
import { listBf6ReceptionEntrants } from '@/lib/bf6DrawDb';
import { listBf6PhotoItemIds } from '@/lib/bf6PhotoDb';
import { listBf6CashOrders } from '@/lib/bf6CashDb';
import { cashTotals } from '@/lib/bf6Cash';

export const dynamic = 'force-dynamic';

export default async function CrewHomePage() {
  const [entrants, photoIds, cashOrders] = await Promise.all([
    listBf6ReceptionEntrants(),
    listBf6PhotoItemIds(),
    listBf6CashOrders(),
  ]);
  const cash = cashTotals(cashOrders);
  const checkedIn = entrants.filter((e) => e.checkedIn).length;
  const withPhoto = entrants.filter((e) => photoIds.has(e.itemId)).length;

  return (
    <div className="mx-auto max-w-xl p-4">
      <header className="pt-4">
        <p className="text-xs font-black tracking-[0.2em] text-brand-600">BOOMER&apos;S FIGHT!!! vol.6</p>
        <h1 className="mt-1 text-2xl font-black text-navy-900">当日オペ</h1>
        <p className="mt-1 text-sm text-neutral-500">2026.9.26(土) SSM 9階ホール</p>
      </header>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-sand-200 bg-white p-3">
          <p className="text-xs font-bold text-neutral-500">チェックイン</p>
          <p className="mt-0.5 text-2xl font-black text-navy-900">
            {checkedIn}
            <span className="text-base font-bold text-neutral-400"> / {entrants.length}</span>
          </p>
        </div>
        <div className="rounded-xl border border-sand-200 bg-white p-3">
          <p className="text-xs font-bold text-neutral-500">写真</p>
          <p className="mt-0.5 text-2xl font-black text-navy-900">
            {withPhoto}
            <span className="text-base font-bold text-neutral-400"> 人ぶん</span>
          </p>
        </div>
        {cash.orders > 0 && (
          <div className="col-span-2 rounded-xl border border-sand-200 bg-white p-3">
            <p className="text-xs font-bold text-neutral-500">当日現金</p>
            <p className="mt-0.5 text-2xl font-black tabular-nums text-navy-900">
              ¥{cash.collectedYen.toLocaleString()}
              <span className="text-base font-bold text-neutral-400">
                {' '}
                / ¥{cash.dueYen.toLocaleString()}
              </span>
              <span className="ml-2 text-sm font-bold text-neutral-400">
                {cash.collectedOrders} / {cash.orders} 件
              </span>
            </p>
          </div>
        )}
      </div>

      <nav className="mt-5 space-y-3">
        {CREW_TASKS.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="block rounded-2xl border border-sand-200 bg-white p-4 shadow-sm transition active:scale-[0.98] active:bg-sand-100 active:shadow-none"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-lg font-black text-navy-900">{t.title}</p>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs font-bold text-brand-600">{t.when}</span>
                <span className="text-xl font-black text-neutral-300">›</span>
              </span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-neutral-500">{t.desc}</p>
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
