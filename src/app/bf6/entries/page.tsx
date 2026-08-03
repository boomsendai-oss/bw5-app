// ⚠️ 公開ページ(認証なし)。理由: BF6エントリーリストは告知の一部として誰でも
// 見られる仕様(TARO 2026-08-03)。掲載はダンサーネーム・ジャンル・REP・部門のみで、
// 本名・連絡先などのPIIは getPublicBf6Entries が返さない(M22)。
import Link from 'next/link';
import { BF6_DIVISIONS, type Bf6Division } from '@/lib/bf6';
import { calcBf6Remaining, getBf6Settings, getBf6Usage, getPublicBf6Entries } from '@/lib/bf6Db';

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
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-8">
        <p className="text-xs font-bold tracking-widest text-red-500">BOOMER&apos;S FIGHT!!! vol.6</p>
        <h1 className="text-3xl font-black text-white">ENTRY LIST</h1>
        <p className="mt-1 text-sm text-zinc-400">2026.9.26(土) SSM 9階ホール / リアルタイム更新</p>

        {BF6_DIVISIONS.map((d) => {
          const list = byDivision.get(d.key) ?? [];
          const cap = settings.capacity[d.key];
          return (
            <section key={d.key} className="mt-8">
              <div className="flex items-end justify-between border-b-2 border-red-600 pb-2">
                <h2 className="text-xl font-black text-white">{d.label}</h2>
                <p className="text-sm text-zinc-400">
                  <span className="font-bold text-red-400">{list.length}</span>/{cap}
                  {remaining.divisions[d.key] === 0 && <span className="ml-2 font-bold text-yellow-500">満枠</span>}
                </p>
              </div>
              {list.length === 0 ? (
                <p className="mt-3 text-sm text-zinc-600">エントリー受付中!</p>
              ) : (
                <ol className="mt-3 space-y-2">
                  {list.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-3 rounded-lg bg-zinc-900 px-4 py-3">
                      <span className="w-6 shrink-0 text-right text-sm font-bold text-zinc-600">{i + 1}</span>
                      <span className="flex-1">
                        <span className="font-bold text-white">{e.dancerName}</span>
                        {(e.genre || e.rep) && (
                          <span className="ml-2 text-xs text-zinc-400">
                            {[e.genre, e.rep].filter(Boolean).join(' / ')}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}

        <Link
          href="/bf6/entry"
          className="mt-10 block w-full rounded-xl bg-red-600 py-4 text-center text-lg font-black text-white"
        >
          エントリーする
        </Link>
        <p className="mt-3 text-center text-xs text-zinc-500">
          <Link href="/bf6" className="underline">イベント詳細へ</Link>
        </p>
      </div>
    </div>
  );
}
