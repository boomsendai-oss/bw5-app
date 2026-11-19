// ⚠️ 公開ページ(認証なし)。理由: プチバトル(BOOM DOJO)のエントリー一覧は告知の一部として誰でも見られる。
// 載せるのはダンサー名・所属・ジャンル・部門だけ。本名・連絡先・生年月日は getPublicBattleEntries が返さない。
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatJpDateLong, isBattleAccepting, nowJstMinute } from '@/lib/battle';
import { getBattleEvent, getBattleRemaining, getCurrentBattleEvent, getPublicBattleEntries } from '@/lib/battleDb';
import { BattleCard, BattleHero, BattleShell, WhiteBelt, btnPrimaryCls } from '../ui';

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
        <BattleHero eventTitle="BOOM DOJO" title="エントリー一覧" />
        <div className="px-[18px]"><BattleCard><p>開催予定のバトルはまだありません。</p></BattleCard></div>
      </BattleShell>
    );
  }
  const [entries, remaining] = await Promise.all([getPublicBattleEntries(ev.eventKey), getBattleRemaining(ev)]);
  const accepting = isBattleAccepting(ev, nowJstMinute());

  return (
    <BattleShell>
      <BattleHero eventTitle={ev.title} title="エントリー一覧" subtitle={`${formatJpDateLong(ev.eventDate)} ${ev.venue}`} />
      <div className="space-y-4 px-[18px]">
        {ev.divisions.map((d) => {
          const list = entries.filter((x) => x.divisions.includes(d.key));
          const left = remaining[d.key] ?? 0;
          return (
            <BattleCard key={d.key}>
              <div className="flex items-center gap-2.5 border-b-2 border-[#1d140c] pb-2">
                <WhiteBelt />
                <h2 className="min-w-0 flex-1 text-[15px] font-black leading-snug">{d.name}</h2>
                <span className={`shrink-0 rounded border-2 px-2 py-0.5 text-xs font-bold ${left > 0 ? 'border-[#1d140c] text-[#1d140c]' : 'border-[#b8261c] text-[#b8261c]'}`}>
                  {left > 0 ? `残り${left}枠` : '満員'}
                </span>
              </div>
              <p className="mt-1 text-xs text-[#6b5a44]">確定 {list.length}名 / 定員 {d.capacity}名</p>
              {list.length === 0 ? (
                <p className="mt-3 text-sm text-[#6b5a44]">まだエントリーはありません</p>
              ) : (
                <ol className="mt-2 divide-y divide-dashed divide-[#b9a98d]">
                  {list.map((x, i) => (
                    <li key={i} className="flex items-baseline gap-3 py-2">
                      <span className="f-num w-6 shrink-0 text-right text-sm text-[#7a2a1c]">{i + 1}</span>
                      <span className="flex-1">
                        <span className="font-black">{x.dancerName}</span>
                        <span className="block text-xs text-[#6b5a44]">{x.rep}{x.genre && ` / ${x.genre}`}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </BattleCard>
          );
        })}
        <p className="text-center text-xs text-[#f3eadb]/60">決済が完了したエントリーだけを載せています</p>
        {accepting && (
          <Link href={`/battle?e=${encodeURIComponent(ev.eventKey)}#entry-form`} className={`block w-full rounded py-4 text-center text-lg font-black ${btnPrimaryCls}`}>
            挑戦する　ENTRY
          </Link>
        )}
      </div>
    </BattleShell>
  );
}
