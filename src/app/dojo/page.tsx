// ⚠️ 公開ページ(認証なし)。理由: 月1回の校内プチバトル(BOOM DOJO)の告知＋申込フォーム。会員以外も申し込める。
// 表示する名前・説明・日付・部門・料金・定員はすべて battle_events(設定)から読む。直書きしない。
// 見た目はデザイン案A「夜の道場」(TARO 2026-11-19 OK)。ロゴ・掛け軸の文字・はんこは飾りなので固定。
// ?e=2026-12-26 で回を指定できる(省略時は今日以降でいちばん近い回)。
import type { Metadata } from 'next';
import Link from 'next/link';
import { formatJpDateLong, formatJpDateTime, isBattleAccepting, nowJstMinute, yen } from '@/lib/battle';
import { getBattleEvent, getBattleRemaining, getCurrentBattleEvent, listBattleEvents } from '@/lib/battleDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { BattleCard, BattlePreviewBanner, BattleShell, BattleHero, DojoCast, DojoHero, DojoRoundTabs, DivisionName, DojoRow, MultiLine, WhiteBelt, btnDarkCls } from './ui';
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
  const roundLabel = ev.title.replace(/^BOOM DOJO\s*/i, '').trim();
  // 切り替えタブ：今日以降の回(テスト回は出さない)。表示中の回が過去なら、それも含める
  const today = now.slice(0, 10);
  const rounds = (await listBattleEvents())
    .filter((r) => !r.eventKey.startsWith('test') && (r.eventDate >= today || r.eventKey === ev.eventKey))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map((r) => {
      const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(r.eventDate);
      return {
        key: r.eventKey,
        label: r.title.replace(/^BOOM DOJO\s*/i, '').trim() || r.title,
        date: m ? `${Number(m[1])}/${Number(m[2])}` : r.eventDate,
        accepting: isBattleAccepting(r, now),
      };
    });

  return (
    <BattleShell>
      {preview && <BattlePreviewBanner />}
      <DojoRoundTabs rounds={rounds} current={ev.eventKey} />
      <DojoHero
        numbering={ev.title.replace(/^BOOM DOJO\s*/i, '').trim() || undefined}
        dateYmd={ev.eventDate}
        venue={ev.venue}
        openTime={ev.openTime}
        ctaHref={showForm ? '#entry-form' : undefined}
        entriesHref={`/dojo/entries?e=${encodeURIComponent(ev.eventKey)}`}
      />

      <div className="space-y-4 px-[18px] pt-7">
        {ev.description && (
          <BattleCard title="BOOM DOJOとは">
            <MultiLine text={ev.description} className="text-sm leading-relaxed" mark="優勝未経験" />
          </BattleCard>
        )}


        <BattleCard title="道場案内" hanko={<>白帯<br />限定</>}>
          <DojoRow k="日時">
            {md ? `${Number(md[1])}月${Number(md[2])}日` : ev.eventDate}{formatJpDateLong(ev.eventDate).replace(/^.*日/, '')}{' '}
            {ev.openTime && `${ev.openTime} OPEN`}{ev.openTime && ev.startTime && ' / '}{ev.startTime && `${ev.startTime} START`}
            {ev.openTime
              ? <span className="block text-xs text-[#6b5a44]">エントリーする方は{ev.openTime}に受付へお越しください。</span>
              : <span className="block text-xs text-[#6b5a44]">時間は調整中です。決まり次第お知らせします。</span>}
          </DojoRow>
          <DojoRow k="会場">
            {ev.venue}
            {ev.venueAddress && <span className="block text-xs text-[#6b5a44]">{ev.venueAddress}</span>}
            {ev.venue.includes('県民会館') && (
              <span className="block text-xs font-bold text-[#b3261e]">会場は土足禁止です。室内用のシューズをお持ちください。</span>
            )}
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
                  <DivisionName name={d.name} note={d.note} />
                  <p className="text-xs text-[#6b5a44]">
                    {[`${d.capacity}名限定`, (remaining[d.key] ?? 0) > 0 ? `残り${remaining[d.key]}枠` : '満員'].filter(Boolean).join('・')}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Link
            href={`/dojo/entries?e=${encodeURIComponent(ev.eventKey)}`}
            className={`mt-3 flex items-center justify-center gap-2 rounded py-3 text-[15px] font-black ${btnDarkCls}`}
          >
            <span>{roundLabel ? `${roundLabel}の` : ''}エントリー一覧を見る</span><span aria-hidden>→</span>
          </Link>
        </BattleCard>

        {ev.rules && (
          <BattleCard title="参加の掟">
            <MultiLine text={ev.rules} className="text-sm leading-relaxed" mark="優勝未経験" />
          </BattleCard>
        )}

        {/* 立会人は未発表の名前を含むので、ブラウザへ送るフォームには渡さない(TARO 11/20) */}
        {showForm ? (
          <BattleForm ev={{ ...ev, cast: [] }} remaining={remaining} now={now} preview={preview} />
        ) : (
          <BattleCard>
            <p className="font-bold">
              {deadlinePassed
                ? `事前申込は${formatJpDateTime(ev.entryDeadline)}で締め切りました。`
                : '現在エントリーは受け付けていません。受付開始までお待ちください。'}
            </p>
          </BattleCard>
        )}

      </div>
    </BattleShell>
  );
}
