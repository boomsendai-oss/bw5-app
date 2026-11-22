// ⚠️ 公開ページ(認証なし)。理由: プチバトル(BOOM DOJO)のエントリー一覧は告知の一部として誰でも見られる。
// 載せるのはダンサー名・所属・ジャンル・部門だけ。本名・連絡先・年齢は getPublicBattleEntries が返さない。
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatJpDateLong, isBattleAccepting, nowJstMinute } from '@/lib/battle';
import { getBattleEvent, getBattleRemaining, getCurrentBattleEvent, getPublicBattleEntries } from '@/lib/battleDb';
import { BattleCard, BattleHero, BattleShell, btnOnDarkCls, btnPrimaryCls } from '../ui';

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

  const roundLabel = ev.title.replace(/^BOOM DOJO\s*/i, '').trim();

  return (
    <BattleShell>
      <BattleHero
        eventTitle={ev.title}
        title="エントリー一覧"
        stamp={roundLabel || undefined}
        subtitle={`${formatJpDateLong(ev.eventDate)} ${ev.venue}`}
      />
      <div className="space-y-4 px-[18px]">
        {/* 部門は横に並べて1画面で見比べられるように(TARO 11/22) */}
        <div className={`grid gap-2.5 ${ev.divisions.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {ev.divisions.map((d) => {
            const list = entries.filter((x) => x.divisions.includes(d.key));
            const left = remaining[d.key] ?? 0;
            return (
              <BattleCard key={d.key}>
                <div className="border-b-2 border-[#1d140c] pb-2">
                  <EntryDivisionHead name={d.name} note={d.note} />
                  <p className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-[11px] text-[#6b5a44]">
                    <span>{list.length}名 / 定員{d.capacity}名</span>
                    <span className={`rounded border-2 px-1.5 py-0.5 text-[11px] font-bold ${left > 0 ? 'border-[#1d140c] text-[#1d140c]' : 'border-[#b8261c] text-[#b8261c]'}`}>
                      {left > 0 ? `残り${left}枠` : '満員'}
                    </span>
                  </p>
                </div>
                {list.length === 0 ? (
                  <p className="mt-3 text-xs text-[#6b5a44]">まだエントリーはありません</p>
                ) : (
                  <ol className="mt-1 divide-y divide-dashed divide-[#b9a98d]">
                    {list.map((x, i) => (
                      <li key={i} className="flex items-baseline gap-2 py-2">
                        <span className="f-num w-5 shrink-0 text-right text-xs text-[#7a2a1c]">{i + 1}</span>
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                          <span className="block text-[15px] font-black leading-tight">{x.dancerName}</span>
                          <span className="block text-[11px] leading-snug text-[#6b5a44]">{x.rep}{x.genre && ` / ${x.genre}`}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </BattleCard>
            );
          })}
        </div>
        <p className="text-center text-xs text-[#f3eadb]/60">お申し込みが完了したエントリーを載せています</p>
        {accepting && (
          <Link href={`/dojo?e=${encodeURIComponent(ev.eventKey)}#entry-form`} className={`block w-full rounded py-4 text-center text-lg font-black ${btnPrimaryCls}`}>
            挑戦する　ENTRY
          </Link>
        )}
        <Link href={`/dojo?e=${encodeURIComponent(ev.eventKey)}`} className={`block w-full rounded py-3 text-center text-sm font-bold ${btnOnDarkCls}`}>
          ← {roundLabel || 'BOOM DOJO'}の案内にもどる
        </Link>
      </div>
    </BattleShell>
  );
}

/** 2列で並べたとき左右の段がそろうよう、札を1行ずつ縦に積む(TARO 11/22)。 */
function EntryDivisionHead({ name, note }: { name: string; note?: string }) {
  const rest = name.replace(/^優勝未経験\s*/, '');
  const m = /^(U\d+|ALL AGE)\s*(.*)$/i.exec(rest);
  const age = m ? m[1] : '';
  const style = m ? m[2] : rest;
  const tag = 'inline-block whitespace-nowrap rounded-sm px-1.5 py-[2px] text-[11px] font-black leading-tight';
  return (
    <div className="space-y-1">
      <span className={`${tag} bg-[#b8261c] tracking-wider text-white`}>優勝未経験</span>
      <div className="h-[22px]">
        {note && <span className={`${tag} border-2 border-[#1d140c] py-[1px] text-[#1d140c]`}>{note}</span>}
      </div>
      <p className="f-num text-[26px] font-black leading-none">{age}</p>
      <p className="whitespace-nowrap text-[12px] font-bold leading-tight text-[#3d2e1e]">{style}</p>
    </div>
  );
}
