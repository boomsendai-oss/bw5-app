// スタッフ：BW6 発表会の最初の画面（数字・見てほしいこと・探す・各画面へ）。
// 個人情報を出すので、proxy の cookie の確認に加えてセッションを本検証する（規約4.5）。
// ?ev= は pickStaffEventKey で決まった3つ（本番・試し・煙の試し）だけを通す。
import Link from 'next/link';
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { RECITAL_EVENT, pickStaffEventKey } from '@/lib/recital';
import { countRecitalPeople, getRecitalEvent, getRecitalSettings, listAttention, searchHouseholds } from '@/lib/recitalDb';
import AttentionList from './AttentionList';
import { liveBanners } from './banners';

export const dynamic = 'force-dynamic';

const EVENT_TABS: { key: string; label: string }[] = [
  { key: RECITAL_EVENT.live, label: '本番' },
  { key: RECITAL_EVENT.test, label: '試し' },
  { key: RECITAL_EVENT.smoke, label: '動作確認' },
];

function withEv(href: string, ev: string): string {
  return `${href}?ev=${encodeURIComponent(ev)}`;
}

/** UTC ISO → JST の 'M/D HH:MM' */
function jstShort(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${hh}:${mm}`;
}

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function StaffBw6Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const sp = await searchParams;
  const ev = pickStaffEventKey(first(sp.ev));
  const q = (first(sp.q) ?? '').trim();
  const isLive = ev === RECITAL_EVENT.live;

  const [event, settings, counts, attention, hits] = await Promise.all([
    getRecitalEvent(ev),
    getRecitalSettings(ev),
    countRecitalPeople(ev),
    listAttention(ev),
    q ? searchHouseholds(ev, q) : Promise.resolve([]),
  ]);
  const settingsHref = withEv('/staff/bw6/settings', ev);
  const banners = liveBanners(settings);

  return (
    <div>
      <StaffPageHeader
        title="BW6 発表会"
        description="申込・お支払い（本番 2027/4/11）"
        rightExtra={
          <nav className="flex flex-wrap gap-2 text-sm" aria-label="発表会の切りかえ">
            {EVENT_TABS.map((t) => (
              <Link
                key={t.key}
                href={withEv('/staff/bw6', t.key)}
                className={
                  t.key === ev
                    ? 'rounded-md bg-brand-600 px-3 py-1 font-bold text-white'
                    : 'rounded-md border border-sand-200 bg-white px-3 py-1 text-brand-700'
                }
              >
                {t.label}
              </Link>
            ))}
          </nav>
        }
      />
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        {!isLive && (
          <p className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-2 text-sm text-navy-700">
            試しの発表会（{ev}）を見ています。ここの申込は本番の数字に入りません。人数は数えません。
          </p>
        )}
        {!event && (
          <p className="rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-sand-800">
            この発表会（{ev}）は、まだ作られていません。
          </p>
        )}
        {isLive && banners.suspended && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            まだ止めたままです（受付は開いていません）。
            <Link href={settingsHref} className="ml-1 font-bold underline">設定の画面へ</Link>
          </p>
        )}
        {isLive && banners.payNotOpen && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            支払いは、まだ開けていません。
            <Link href={settingsHref} className="ml-1 font-bold underline">設定の画面へ</Link>
          </p>
        )}

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <form method="get" className="flex gap-2">
            <input type="hidden" name="ev" value={ev} />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="名前・カナ・整理番号で探す"
              className={RECITAL_INPUT_CLS}
            />
            <button type="submit" className="shrink-0 rounded-lg bg-brand-600 px-4 py-2 font-bold text-white">
              探す
            </button>
          </form>
          {q && (
            <div className="mt-3">
              {hits.length === 0 ? (
                <p className="text-sm text-sand-700">見つかりませんでした</p>
              ) : (
                <ul className="divide-y divide-sand-100">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Link href={withEv(`/staff/bw6/entries/${h.id}`, ev)} className="flex flex-wrap items-baseline gap-x-3 py-2 text-navy-700">
                        <span className="font-mono font-bold text-brand-700">{h.ref_code}</span>
                        <span className="min-w-0 break-words">{h.contact_name}</span>
                        {h.status === 'merged' && <span className="rounded bg-sand-100 px-2 text-xs text-sand-800">まとめた</span>}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
          <p className="text-2xl font-bold">
            出る人 {counts.going}人<span className="ml-2 text-base font-normal text-sand-700">（目標{settings.goal_people}）</span>
          </p>
          <p className="mt-1 text-base">
            お支払いずみ {counts.paid}人 ／ まだ {counts.unpaid}人
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-sand-700">
            <span>迷っている {counts.maybe}人</span>
            <span>参加費なし・Tシャツ代だけの人 {counts.special}人</span>
            <span>{jstShort(counts.countedAt)} 時点</span>
          </div>
        </section>

        <AttentionList items={attention} ev={ev} />

        <nav className="grid grid-cols-3 gap-2" aria-label="各画面へ">
          {[
            { href: '/staff/bw6/works', label: '作品' },
            { href: '/staff/bw6/entries', label: '申込' },
            { href: '/staff/bw6/settings', label: '設定' },
            { href: '/staff/bw6/bank', label: '見てほしい入金' },
            { href: '/staff/bw6/bank/import', label: '入金の取り込み' },
          ].map((b) => (
            <Link
              key={b.href}
              href={withEv(b.href, ev)}
              className="rounded-lg border border-sand-200 bg-white px-3 py-3 text-center font-bold text-brand-700"
            >
              {b.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
