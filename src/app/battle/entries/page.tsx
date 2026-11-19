// ⚠️ 公開ページ(認証なし)。理由: プチバトルのエントリー一覧は告知の一部として誰でも見られる。
// 載せるのはダンサー名・所属・ジャンル・部門だけ。本名・連絡先・生年月日は getPublicBattleEntries が返さない。
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatJpDateLong, isBattleAccepting, nowJstMinute } from '@/lib/battle';
import { getBattleEvent, getBattleRemaining, getCurrentBattleEvent, getPublicBattleEntries } from '@/lib/battleDb';
import { BattleCard, BattleHero, BattleShell, btnPrimaryCls } from '../ui';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ e?: string }> };

async function loadEvent(e?: string) {
  return e ? getBattleEvent(e) : getCurrentBattleEvent(nowJstMinute().slice(0, 10));
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { e } = await searchParams;
  const ev = await loadEvent(e).catch(() => null);
  return { title: ev ? `${ev.title} エントリー一覧` : 'エントリー一覧' };
}

export default async function BattleEntriesPage({ searchParams }: Props) {
  const { e } = await searchParams;
  const ev = await loadEvent(e);
  if (!ev) {
    return (
      <BattleShell>
        <BattleHero eventTitle="BOOM DANCE SCHOOL" title="ENTRY LIST" />
        <div className="px-4"><BattleCard><p className="text-neutral-300">開催予定のバトルはまだありません。</p></BattleCard></div>
      </BattleShell>
    );
  }
  const [entries, remaining] = await Promise.all([getPublicBattleEntries(ev.eventKey), getBattleRemaining(ev)]);
  const accepting = isBattleAccepting(ev, nowJstMinute());

  return (
    <BattleShell>
      <BattleHero eventTitle={ev.title} title="ENTRY LIST" subtitle={`${formatJpDateLong(ev.eventDate)} ${ev.venue}`} />
      <div className="space-y-4 px-4">
        {ev.divisions.map((d) => {
          const list = entries.filter((x) => x.divisions.includes(d.key));
          const left = remaining[d.key] ?? 0;
          return (
            <BattleCard key={d.key}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-black text-white">{d.name}</h2>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${left > 0 ? 'bg-neutral-800 text-teal-200' : 'bg-yellow-200 text-yellow-900'}`}>
                  {left > 0 ? `残り${left}枠` : '満員'}
                </span>
              </div>
              <p className="text-xs text-neutral-400">確定 {list.length}名 / 定員 {d.capacity}名</p>
              {list.length === 0 ? (
                <p className="mt-3 text-sm text-neutral-500">まだエントリーはありません</p>
              ) : (
                <ol className="mt-3 divide-y divide-neutral-800">
                  {list.map((x, i) => (
                    <li key={i} className="flex items-baseline gap-3 py-2">
                      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-neutral-500">{i + 1}</span>
                      <span className="flex-1">
                        <span className="font-bold text-white">{x.dancerName}</span>
                        <span className="block text-xs text-neutral-400">{x.rep}{x.genre && ` / ${x.genre}`}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </BattleCard>
          );
        })}
        <p className="text-center text-xs text-neutral-500">決済が完了したエントリーだけを載せています</p>
        {accepting && (
          <Link href={`/battle?e=${encodeURIComponent(ev.eventKey)}`} className={`block w-full rounded-2xl py-4 text-center text-lg font-black ${btnPrimaryCls}`}>
            エントリーする
          </Link>
        )}
      </div>
    </BattleShell>
  );
}
