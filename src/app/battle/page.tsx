// ⚠️ 公開ページ(認証なし)。理由: 月1回の校内プチバトルの告知＋申込フォーム。会員以外も申し込める。
// 表示する名前・説明・日付・部門・料金・定員はすべて battle_events(設定)から読む。直書きしない。
// ?e=2026-12-26 で回を指定できる(省略時は今日以降でいちばん近い回)。
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatJpDateLong, formatJpDateTime, isBattleAccepting, nowJstMinute, yen } from '@/lib/battle';
import { getBattleEvent, getBattleRemaining, getCurrentBattleEvent } from '@/lib/battleDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { BattleCard, BattleHero, BattlePreviewBanner, BattleShell, MultiLine } from './ui';
import BattleForm from './BattleForm';

export const dynamic = 'force-dynamic';

type Props = { searchParams: Promise<{ e?: string }> };

async function loadEvent(e?: string) {
  const now = nowJstMinute();
  return e ? getBattleEvent(e) : getCurrentBattleEvent(now.slice(0, 10));
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { e } = await searchParams;
  const ev = await loadEvent(e).catch(() => null);
  if (!ev) return { title: 'BOOM バトル' };
  const desc = `${formatJpDateLong(ev.eventDate)} ${ev.venue} / ${ev.subtitle}`;
  return { title: `${ev.title} | ${formatJpDateLong(ev.eventDate)}`, description: desc, openGraph: { title: ev.title, description: desc } };
}

export default async function BattlePage({ searchParams }: Props) {
  const { e } = await searchParams;
  const ev = await loadEvent(e);
  if (!ev) {
    return (
      <BattleShell>
        <BattleHero eventTitle="BOOM DANCE SCHOOL" title="BATTLE" />
        <div className="px-4"><BattleCard><p className="text-neutral-300">開催予定のバトルはまだありません。</p></BattleCard></div>
      </BattleShell>
    );
  }
  const now = nowJstMinute();
  const accepting = isBattleAccepting(ev, now);
  const preview = !accepting && (await isAuthorizedServer());
  const remaining = await getBattleRemaining(ev);
  const deadlinePassed = Boolean(ev.entryDeadline) && now >= ev.entryDeadline;

  return (
    <BattleShell>
      {preview && <BattlePreviewBanner />}
      <BattleHero eventTitle={ev.title} title="BATTLE ENTRY" subtitle={ev.subtitle} />

      <div className="space-y-4 px-4">
        {ev.description && (
          <BattleCard>
            <MultiLine text={ev.description} className="text-sm leading-relaxed text-neutral-200" />
          </BattleCard>
        )}

        <BattleCard label="DETAIL">
          <dl className="space-y-3 text-sm">
            <Row k="日時">
              {formatJpDateLong(ev.eventDate)} {ev.openTime}〜{ev.endTime}
              {(ev.openTime || ev.startTime) && (
                <span className="block text-xs text-neutral-400">
                  {ev.openTime && `${ev.openTime} 受付開始`}{ev.openTime && ev.startTime && ' / '}{ev.startTime && `${ev.startTime} 開始`}
                </span>
              )}
            </Row>
            <Row k="会場">
              {ev.venue}
              {ev.venueAddress && <span className="block text-xs text-neutral-400">{ev.venueAddress}</span>}
            </Row>
            <Row k="部門">
              <ul className="space-y-1.5">
                {ev.divisions.map((d) => (
                  <li key={d.key}>
                    <span className="font-bold text-white">{d.name}</span>
                    <span className="block text-xs text-neutral-400">
                      {d.capacity}名限定{d.note ? ` / ${d.note}` : ''} / 残り{remaining[d.key] ?? 0}枠
                    </span>
                  </li>
                ))}
              </ul>
            </Row>
            {ev.moveSeconds > 0 && <Row k="ルール">1ムーブ {ev.moveSeconds}秒</Row>}
            <Row k="エントリー料">
              1部門 {yen(ev.entryFee)}
              {ev.entryFeeLate > 0 && ev.lateFeeFrom && (
                <span className="block text-xs text-neutral-400">
                  {formatJpDateTime(ev.lateFeeFrom)}以降は {yen(ev.entryFeeLate)}
                </span>
              )}
              {ev.divisions.length > 1 && <span className="block text-xs text-neutral-400">複数の部門に出る場合は部門ごとにかかります</span>}
            </Row>
            <Row k="観覧">
              {ev.spectatorFee > 0 ? `${yen(ev.spectatorFee)}` : '無料'}
              {ev.spectatorNote && <span className="text-xs text-neutral-400">({ev.spectatorNote})</span>}
            </Row>
            {ev.entryDeadline && <Row k="事前申込の締切">{formatJpDateTime(ev.entryDeadline)}</Row>}
          </dl>
        </BattleCard>

        {ev.rules && (
          <BattleCard label="参加条件">
            <MultiLine text={ev.rules} className="text-sm leading-relaxed text-neutral-200" />
          </BattleCard>
        )}

        {accepting || preview ? (
          <BattleForm ev={ev} remaining={remaining} now={now} preview={preview} />
        ) : (
          <BattleCard>
            <p className="text-neutral-200">
              {deadlinePassed
                ? `事前申込は${formatJpDateTime(ev.entryDeadline)}で締め切りました。`
                : '現在エントリーは受け付けていません。受付開始までお待ちください。'}
            </p>
          </BattleCard>
        )}

        <p className="pt-2 text-center text-xs text-neutral-400">
          <Link href={`/battle/entries?e=${encodeURIComponent(ev.eventKey)}`} className="underline">エントリー一覧を見る</Link>
        </p>
      </div>
    </BattleShell>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2">
      <dt className="text-xs font-bold text-teal-300">{k}</dt>
      <dd className="text-neutral-100">{children}</dd>
    </div>
  );
}
