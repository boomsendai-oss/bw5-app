// ⚠️ 公開ページ(認証なし)。理由: 月1回の校内プチバトル(BOOM DOJO)の告知＋申込フォーム。会員以外も申し込める。
// 表示する名前・説明・日付・部門・料金・定員はすべて battle_events(設定)から読む。直書きしない。
// 見た目はデザイン案A「夜の道場」(TARO 2026-11-19 OK)。ロゴ・掛け軸の文字・はんこは飾りなので固定。
// ?e=2026-12-26 で回を指定できる(省略時は今日以降でいちばん近い回)。
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatJpDateLong, formatJpDateTime, isBattleAccepting, nowJstMinute, yen } from '@/lib/battle';
import { getBattleEvent, getBattleRemaining, getCurrentBattleEvent } from '@/lib/battleDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { BattleCard, BattlePreviewBanner, BattleShell, BattleHero, DojoCast, DojoHero, DojoRow, MultiLine, WhiteBelt } from './ui';
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
  if (!ev) return { title: 'BOOM DOJO' };
  const desc = `${formatJpDateLong(ev.eventDate)} ${ev.venue} / ${ev.subtitle}`;
  return { title: `${ev.title} | ${formatJpDateLong(ev.eventDate)}`, description: desc, openGraph: { title: ev.title, description: desc } };
}

export default async function BattlePage({ searchParams }: Props) {
  const { e } = await searchParams;
  const ev = await loadEvent(e);
  if (!ev) {
    return (
      <BattleShell>
        <BattleHero eventTitle="BOOM DOJO" title="開催予定" />
        <div className="px-[18px]"><BattleCard><p>開催予定のバトルはまだありません。</p></BattleCard></div>
      </BattleShell>
    );
  }
  const now = nowJstMinute();
  const accepting = isBattleAccepting(ev, now);
  const preview = !accepting && (await isAuthorizedServer());
  const remaining = await getBattleRemaining(ev);
  const deadlinePassed = Boolean(ev.entryDeadline) && now >= ev.entryDeadline;
  const showForm = accepting || preview;
  const md = /^\d{4}-(\d{2})-(\d{2})$/.exec(ev.eventDate);

  return (
    <BattleShell>
      {preview && <BattlePreviewBanner />}
      <DojoHero
        numbering={ev.title.replace(/^BOOM DOJO\s*/i, '').trim() || undefined}
        dateYmd={ev.eventDate}
        venue={ev.venue}
        startTime={ev.startTime}
        ctaHref={showForm ? '#entry-form' : undefined}
      />

      <div className="space-y-4 px-[18px] pt-7">
        {ev.description && (
          <BattleCard>
            <MultiLine text={ev.description} className="text-sm leading-relaxed" />
          </BattleCard>
        )}

        <BattleCard title="道場の掟" hanko={<>白帯<br />限定</>}>
          <DojoRow k="日時">
            {md ? `${Number(md[1])}月${Number(md[2])}日` : ev.eventDate}{formatJpDateLong(ev.eventDate).replace(/^.*日/, '')}{' '}
            {ev.openTime && `${ev.openTime}受付`}{ev.openTime && ev.startTime && ' / '}{ev.startTime && `${ev.startTime}開始`}
          </DojoRow>
          <DojoRow k="会場">
            {ev.venue}
            {ev.venueAddress && <span className="block text-xs text-[#6b5a44]">{ev.venueAddress}</span>}
          </DojoRow>
          <DojoRow k="ルール">1on1{ev.moveSeconds > 0 && `・1ムーブ${ev.moveSeconds}秒`}</DojoRow>
          <DojoRow k="参加費">
            エントリー{yen(ev.entryFee)}{ev.spectatorFee > 0 ? `／観覧${yen(ev.spectatorFee)}` : '／観覧無料'}
            <span className="block text-xs text-[#6b5a44]">
              {ev.divisions.length > 1 && 'エントリー料は部門ごと。'}
              {ev.spectatorNote && `観覧は${ev.spectatorNote}。`}
              {ev.entryFeeLate > 0 && ev.lateFeeFrom && `${formatJpDateTime(ev.lateFeeFrom)}以降のエントリーは${yen(ev.entryFeeLate)}。`}
            </span>
          </DojoRow>
          {ev.entryDeadline && <DojoRow k="申込締切">{formatJpDateTime(ev.entryDeadline)}</DojoRow>}
        </BattleCard>

        <DojoCast cast={ev.cast} numbering={ev.title.replace(/^BOOM DOJO\s*/i, '').trim() || undefined} />

        <BattleCard title="部門">
          <div className="space-y-2.5">
            {ev.divisions.map((d) => (
              <div key={d.key} className="flex items-center gap-2.5 rounded-md border border-[#d8c8aa] bg-[#fff8ec] p-2.5">
                <WhiteBelt />
                <div className="min-w-0">
                  <p className="text-[15px] font-black leading-snug">{d.name}</p>
                  <p className="text-xs text-[#6b5a44]">
                    {[d.note, `${d.capacity}名限定`, (remaining[d.key] ?? 0) > 0 ? `残り${remaining[d.key]}枠` : '満員'].filter(Boolean).join('・')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </BattleCard>

        {ev.rules && (
          <BattleCard title="参加条件">
            <MultiLine text={ev.rules} className="text-sm leading-relaxed" />
          </BattleCard>
        )}

        {showForm ? (
          <BattleForm ev={ev} remaining={remaining} now={now} preview={preview} />
        ) : (
          <BattleCard>
            <p className="font-bold">
              {deadlinePassed
                ? `事前申込は${formatJpDateTime(ev.entryDeadline)}で締め切りました。`
                : '現在エントリーは受け付けていません。受付開始までお待ちください。'}
            </p>
          </BattleCard>
        )}

        <p className="pt-2 text-center text-xs text-[#f3eadb]/70">
          <Link href={`/dojo/entries?e=${encodeURIComponent(ev.eventKey)}`} className="underline">エントリー一覧を見る</Link>
        </p>
      </div>
    </BattleShell>
  );
}
