// ⚠️ 公開ページ(認証なし)。理由: BF6エントリーリストは告知の一部として誰でも
// 見られる仕様(TARO 2026-08-03)。掲載はダンサーネーム・ジャンル・レペゼン・部門のみで、
// 本名・連絡先などのPIIは getPublicBf6Entries が返さない(M22)。
import Link from 'next/link';
import { BF6_DIVISIONS, type Bf6Division } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Settings, getBf6Usage, getPublicBf6Entries } from '@/lib/bf6Db';
import { Bf6Hero } from '../ui';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 エントリーリスト",
  description: '2026.9.26(土) SSM 9階ホール — 各部門のエントリーリスト(リアルタイム更新)',
};

export default async function Bf6EntriesPage() {
  const [settings, usage, entries] = await Promise.all([
    getBf6Settings(),
    getBf6Usage(),
    getPublicBf6Entries(),
  ]);
  const remaining = calcBf6Remaining(settings, usage);

  const byDivision = new Map<Bf6Division, typeof entries>();
  for (const d of BF6_DIVISIONS) byDivision.set(d.key, []);
  for (const e of entries) {
    for (const d of e.divisions) byDivision.get(d)?.push(e);
  }

  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-lg pb-12">
        <Bf6Hero title="ENTRY LIST" subtitle="2026.9.26 SAT — SSM 9階ホール / リアルタイム更新" />
        <div className="px-4 py-6">
          {BF6_DIVISIONS.map((d) => {
            const list = byDivision.get(d.key) ?? [];
            const cap = settings.capacity[d.key];
            return (
              <section key={d.key} className="mt-7 first:mt-0">
                <div className="flex items-end justify-between rounded-t-2xl bg-neutral-900 px-4 py-3">
                  <div>
                    <h2 className="text-lg font-black italic text-white">{d.label}</h2>
                    <p className="text-[10px] text-neutral-400">{d.note}</p>
                  </div>
                  <p className="text-sm font-bold text-neutral-300">
                    <span className="text-xl font-black text-red-500">{list.length}</span>
                    <span className="text-neutral-500">/{cap}</span>
                    {remaining.divisions[d.key] === 0 && (
                      <span className="ml-2 rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-black text-neutral-900">満枠</span>
                    )}
                  </p>
                </div>
                <div className="rounded-b-2xl border border-t-0 border-neutral-200 bg-white shadow-sm">
                  {list.length === 0 ? (
                    <p className="px-4 py-5 text-sm font-bold text-neutral-400">エントリー受付中!</p>
                  ) : (
                    <ol className="divide-y divide-neutral-100">
                      {list.map((e, i) => (
                        <li key={i} className="flex items-center gap-3 px-4 py-3">
                          <span className="w-7 shrink-0 text-right text-sm font-black italic text-neutral-300">
                            {i + 1}
                          </span>
                          <span className="flex-1">
                            <span className="text-base font-black text-neutral-900">{e.dancerName}</span>
                            <span className="block text-xs text-neutral-500">
                              {[e.genre, e.rep && `REP: ${e.rep}`].filter(Boolean).join(' / ')}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </section>
            );
          })}

          <Link
            href="/bf6/entry"
            className="mt-10 block w-full rounded-2xl bg-red-600 py-4 text-center text-lg font-black text-white shadow-lg shadow-red-600/30"
          >
            エントリーする
          </Link>
          <p className="mt-4 text-center text-xs text-neutral-400">
            <Link href="/bf6" className="underline">イベント詳細へ</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
