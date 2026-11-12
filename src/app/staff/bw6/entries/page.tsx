// スタッフ：BW6 発表会の申込の一覧（04 4-4・R-101）。上に見え方ごとの世帯と人の数、しぼりこみ ?view=、行を押すと世帯の画面。
// 個人情報を出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。
// ?ev= は pickStaffEventKey で決まった3つだけ。スマホ（md 未満）は1世帯1カード、広い画面は表。
// 「期限を過ぎた」のしぼりこみは総点検のあと（後の計画）。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { RECITAL_EVENT, householdViewLabel, pickStaffEventKey, type HouseholdView } from '@/lib/recital';
import { listEntryRows, type EntryListRow } from '@/lib/recitalDb';

export const dynamic = 'force-dynamic';

const VIEWS: { key: HouseholdView; label: string }[] = [
  { key: 'tentative', label: '仮受付' },
  { key: 'complete', label: '申込完了' },
  { key: 'complete_extra', label: '申込完了（追加分がお支払い待ち）' },
  { key: 'none', label: '出演なし' },
];
const FILTERS: readonly string[] = ['all', ...VIEWS.map((v) => v.key)];

const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function listHref(ev: string, view: string): string {
  return `/staff/bw6/entries?ev=${encodeURIComponent(ev)}${view === 'all' ? '' : `&view=${view}`}`;
}

function Marks({ r }: { r: EntryListRow }) {
  return (
    <>
      {!r.mailOpened && <span className="rounded bg-sand-100 px-1.5 text-xs text-sand-800">控えから未開</span>}
      {r.bankTold && <span className="rounded bg-navy-50 px-1.5 text-xs font-bold text-navy-700">確認中</span>}
    </>
  );
}

export default async function StaffBw6EntriesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const viewParam = first(sp.view) ?? 'all';
  const filter = FILTERS.includes(viewParam) ? viewParam : 'all';
  const isLive = ev === RECITAL_EVENT.live;

  const rows = await listEntryRows(ev);
  const counts = new Map<HouseholdView, { households: number; people: number }>(VIEWS.map((v) => [v.key, { households: 0, people: 0 }]));
  for (const r of rows) {
    const c = counts.get(r.view)!;
    c.households++;
    c.people += r.peopleCount;
  }
  const shown = filter === 'all' ? rows : rows.filter((r) => r.view === filter);
  const rowHref = (id: number) => `/staff/bw6/entries/${id}`;

  return (
    <div>
      <StaffPageHeader title="申込の一覧" description="BW6 発表会" backHref={`/staff/bw6?ev=${encodeURIComponent(ev)}`} backLabel="BW6 発表会" />
      <div className="mx-auto max-w-5xl space-y-5 p-4">
        {!isLive && (
          <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
            試しの発表会（{ev}）を見ています。
          </p>
        )}

        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {VIEWS.map((v) => {
              const c = counts.get(v.key)!;
              return (
                <li key={v.key}>
                  {v.label} <span className="font-bold">{c.households}世帯（{c.people}人）</span>
                </li>
              );
            })}
          </ul>
          <form method="get" action="/staff/bw6" className="mt-3 flex gap-2">
            <input type="hidden" name="ev" value={ev} />
            <input type="search" name="q" placeholder="名前・カナ・整理番号で探す" className={RECITAL_INPUT_CLS} />
            <button type="submit" className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 font-bold text-white">探す</button>
          </form>
        </section>

        <nav className="flex flex-wrap gap-2 text-sm" aria-label="しぼりこみ">
          {[{ key: 'all', label: 'すべて' }, ...VIEWS].map((v) => (
            <Link
              key={v.key}
              href={listHref(ev, v.key)}
              className={
                v.key === filter
                  ? 'rounded-md bg-brand-600 px-3 py-1 font-bold text-white'
                  : 'rounded-md border border-sand-200 bg-white px-3 py-1 text-brand-700'
              }
            >
              {v.label}
            </Link>
          ))}
        </nav>

        {shown.length === 0 ? (
          <p className="text-sm text-sand-700">申込はありません</p>
        ) : (
          <>
            <ul className="space-y-2 md:hidden">
              {shown.map((r) => (
                <li key={r.id}>
                  <Link href={rowHref(r.id)} className="block rounded-xl border border-sand-200 bg-white p-3 text-navy-700">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="font-mono text-lg font-bold text-brand-700">{r.refCode}</span>
                      <span className="min-w-0 break-words">{r.contactName}</span>
                      <Marks r={r} />
                    </div>
                    <p className="mt-1 text-sm font-bold">{householdViewLabel(r.view, r.remaining)}</p>
                    <p className="mt-1 text-sm">
                      {r.peopleCount}人・{r.worksCount}作品 ／ 今 {yen(r.total)}・払った {yen(r.paid)}・残り <span className="font-bold">{yen(r.remaining)}</span>
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto rounded-xl border border-sand-200 bg-white md:block">
              <table className="w-full text-sm text-navy-700">
                <thead className="bg-sand-50 text-left text-xs text-sand-800">
                  <tr>
                    <th className="px-3 py-2">整理番号</th>
                    <th className="px-3 py-2">連絡する人</th>
                    <th className="px-3 py-2 text-right">人数</th>
                    <th className="px-3 py-2 text-right">作品</th>
                    <th className="px-3 py-2 text-right">今の金額</th>
                    <th className="px-3 py-2 text-right">払った額</th>
                    <th className="px-3 py-2 text-right">残り</th>
                    <th className="px-3 py-2">状態</th>
                    <th className="px-3 py-2">印</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-sand-100">
                  {shown.map((r) => (
                    <tr key={r.id} className="hover:bg-sand-50">
                      <td className="px-3 py-2">
                        <Link href={rowHref(r.id)} className="font-mono font-bold text-brand-700 underline">{r.refCode}</Link>
                      </td>
                      <td className="px-3 py-2"><Link href={rowHref(r.id)}>{r.contactName}</Link></td>
                      <td className="px-3 py-2 text-right">{r.peopleCount}</td>
                      <td className="px-3 py-2 text-right">{r.worksCount}</td>
                      <td className="px-3 py-2 text-right">{yen(r.total)}</td>
                      <td className="px-3 py-2 text-right">{yen(r.paid)}</td>
                      <td className="px-3 py-2 text-right font-bold">{yen(r.remaining)}</td>
                      <td className="px-3 py-2">{householdViewLabel(r.view, r.remaining)}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><Marks r={r} /></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
