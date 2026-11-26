// ⚠️ 公開ページ(認証なし)。理由: BOOMダンススクールが主催する特設ワークショップの告知＋申込フォーム。会員以外も申し込める。
// 講師・日時・会場・料金・定員・締切・写真・紹介文はすべて sp_ws_events(設定)から読む。直書きしない。
// 写真が無くても見栄えするよう、講師名を大きな文字で見せる。写真URLが入ればヒーローに写真を出す。
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatJpDateTime, isSpWsAccepting, nowJstMinute, spWsDateParts, spWsGateError, splitLines, venueLabel, yen } from '@/lib/spWs';
import { getSpWsEvent, getSpWsRemaining } from '@/lib/spWsDb';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { MultiLine, WsCard, WsPreviewBanner, WsRow, WsShell, btnPrimaryCls } from '../ui';
import WsForm from './WsForm';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const ev = await getSpWsEvent(slug).catch(() => null);
  if (!ev) return { title: 'ワークショップ | BOOM DANCE SCHOOL' };
  const d = spWsDateParts(ev.eventDate);
  const desc = `${d.jp} ${ev.startTime}〜${ev.endTime} / 参加費${yen(ev.fee)} / 定員${ev.capacity}名・どなたでも参加できます`;
  return {
    title: `${ev.title} | BOOM DANCE SCHOOL`,
    description: desc,
    openGraph: { title: ev.title, description: desc, ...(ev.photoUrl ? { images: [ev.photoUrl] } : {}) },
  };
}

export default async function WsPage({ params }: Props) {
  const { slug } = await params;
  const ev = await getSpWsEvent(slug);
  if (!ev) notFound();

  const now = nowJstMinute();
  const remaining = await getSpWsRemaining(ev);
  const accepting = isSpWsAccepting(ev, now, remaining);
  const preview = !accepting && (await isAuthorizedServer());
  const showForm = accepting || preview;
  const closedReason = spWsGateError(ev, now, remaining);
  const d = spWsDateParts(ev.eventDate);
  const belongings = splitLines(ev.belongings);

  return (
    <WsShell>
      {preview && <WsPreviewBanner />}

      {/* ヒーロー: 写真があれば写真、無ければ講師名を大きな文字で */}
      <header className="relative overflow-hidden bg-[#16142b] text-white">
        {ev.photoUrl ? (
          <div className="relative aspect-[4/5] w-full">
            {/* eslint-disable-next-line @next/next/no-img-element -- 写真URLはDBの設定値(外部URLもありうる) */}
            <img src={ev.photoUrl} alt={ev.instructorName} className="absolute inset-0 h-full w-full object-cover object-[50%_30%]" />
            {/* 顔に文字がかからないよう、暗くするのは写真の下の方だけ */}
            <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-[#16142b] via-[#16142b]/70 to-transparent" aria-hidden />
            <p className="absolute left-6 top-5 text-[10px] font-bold tracking-[0.35em] text-white/80 [text-shadow:0_1px_6px_rgba(0,0,0,.7)]">BOOM DANCE SCHOOL PRESENTS</p>
          </div>
        ) : (
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-6 select-none text-[13rem] font-bold leading-none text-white/[0.05] f-num">
            {ev.instructorName}
          </div>
        )}
        <div className={`relative px-6 ${ev.photoUrl ? '-mt-14 pt-0' : 'pt-12'} pb-9`}>
          {!ev.photoUrl && <p className="text-[10px] font-bold tracking-[0.35em] text-white/60">BOOM DANCE SCHOOL PRESENTS</p>}
          <h1 className={ev.photoUrl ? '' : 'mt-5'}>
            <span className="f-num block text-[5.5rem] font-bold leading-[0.9] tracking-tight">{ev.instructorName || ev.title}</span>
            <span className="f-num mt-2 block text-2xl font-medium tracking-[0.18em] text-[#7fe0d2]">SPECIAL WORKSHOP</span>
          </h1>
          {(ev.instructorFrom || ev.instructorKana) && (
            <p className="mt-3 text-sm text-white/80">
              {ev.instructorKana && <span>{ev.instructorKana}</span>}
              {ev.instructorKana && ev.instructorFrom && <span className="mx-2 text-white/40">|</span>}
              {ev.instructorFrom && <span className="f-num tracking-widest">{ev.instructorFrom}</span>}
            </p>
          )}
          {ev.instructorGenre && <p className="mt-1 text-xs text-white/60">{ev.instructorGenre}</p>}
        </div>
      </header>

      {/* 大事な数字: 日時・料金・定員＋申込ボタン（残り枠は出さない・2026-11-26 TARO） */}
      <div className="relative -mt-4 px-4">
        <div className="rounded-2xl bg-white p-5 shadow-[0_10px_30px_rgba(22,20,43,0.12)]">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-[#6b6880]">{d.year}</p>
              <p className="leading-none">
                <span className="f-num text-[3.4rem] font-bold">{d.md}</span>
                <span className="f-num ml-1.5 text-lg font-medium text-[#00a090]">{d.dow}</span>
              </p>
            </div>
            <p className="f-num pb-1 text-2xl font-medium">
              {ev.startTime}<span className="mx-1 text-[#6b6880]">–</span>{ev.endTime}
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#efeae1] pt-4">
            <div>
              <p className="text-xs font-bold text-[#6b6880]">参加費</p>
              <p className="f-num text-3xl font-bold">{yen(ev.fee)}</p>
              <p className="text-[11px] text-[#6b6880]">会員・一般とも同じ</p>
            </div>
            <div>
              <p className="text-xs font-bold text-[#6b6880]">定員</p>
              <p className="text-sm font-bold">{remaining === 0 ? '満員' : <><span className="f-num text-3xl">{ev.capacity}</span> 名</>}</p>
              <p className="text-[11px] text-[#6b6880]">先着順</p>
            </div>
          </div>
          <div className="mt-4 rounded-xl bg-[#f6f3ee] px-3.5 py-2.5 text-sm">
            <span className="mr-2 text-xs font-bold text-[#6b6880]">会場</span>
            <span className={ev.venue ? 'font-bold' : 'font-bold text-[#c2410c]'}>{venueLabel(ev)}</span>
          </div>
          {showForm ? (
            <a href="#entry-form" className={`mt-4 flex items-center justify-center gap-2 rounded-full py-4 text-lg font-bold ${btnPrimaryCls}`}>
              申し込む<span aria-hidden>→</span>
            </a>
          ) : (
            <p className="mt-4 rounded-full bg-[#efeae1] py-4 text-center font-bold text-[#6b6880]">{closedReason}</p>
          )}
          {ev.entryDeadline && showForm && (
            <p className="mt-2 text-center text-xs text-[#6b6880]">締切 {formatJpDateTime(ev.entryDeadline)}・定員になりしだい締め切ります</p>
          )}
        </div>
      </div>

      <div className="space-y-4 px-4 pt-6">
        {ev.description && (
          <WsCard title="ワークショップについて">
            <MultiLine text={ev.description} className="space-y-1 text-[15px] leading-relaxed" />
          </WsCard>
        )}

        <WsCard title="講師">
          <div className="flex items-center gap-4">
            {ev.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 写真URLはDBの設定値
              <img src={ev.photoUrl} alt={ev.instructorName} className="h-20 w-20 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="f-num flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#16142b] text-3xl font-bold text-white" aria-hidden>
                {ev.instructorName.slice(0, 2)}
              </div>
            )}
            <div className="min-w-0">
              <p className="f-num text-3xl font-bold leading-none">{ev.instructorName}</p>
              <p className="mt-1 text-sm text-[#6b6880]">
                {[ev.instructorKana, ev.instructorFrom].filter(Boolean).join(' / ')}
              </p>
              {ev.instructorInstagram && (
                <a href={`https://www.instagram.com/${encodeURIComponent(ev.instructorInstagram)}/`} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-bold text-[#00a090] underline">
                  @{ev.instructorInstagram}
                </a>
              )}
            </div>
          </div>
          {ev.instructorBio && <MultiLine text={ev.instructorBio} className="mt-4 space-y-1 text-[15px] leading-relaxed" />}
        </WsCard>

        <WsCard title="くわしい内容">
          <WsRow k="日時">{d.jp} {ev.startTime}〜{ev.endTime}</WsRow>
          <WsRow k="会場">
            <span className={ev.venue ? '' : 'font-bold text-[#c2410c]'}>{venueLabel(ev)}</span>
            {ev.venueAddress && <span className="block text-xs text-[#6b6880]">{ev.venueAddress}</span>}
          </WsRow>
          <WsRow k="参加費">
            {yen(ev.fee)}
            <span className="block text-xs text-[#6b6880]">BOOMの会員さんも、会員でない方も同じです。カードで先に払うか、当日会場で現金で払うかを選べます</span>
          </WsRow>
          <WsRow k="定員">{ev.capacity}名(先着順)</WsRow>
          {ev.target && <WsRow k="対象">{ev.target}</WsRow>}
          {belongings.length > 0 && (
            <WsRow k="持ち物">
              <ul className="flex flex-wrap gap-1.5">
                {belongings.map((b) => (
                  <li key={b} className="rounded-full bg-[#f6f3ee] px-3 py-1 text-sm">{b}</li>
                ))}
              </ul>
            </WsRow>
          )}
          {ev.entryDeadline && <WsRow k="締切">{formatJpDateTime(ev.entryDeadline)}<span className="block text-xs text-[#6b6880]">定員になりしだい締め切ります</span></WsRow>}
          <WsRow k="お問い合わせ">{ev.contact || 'BOOM公式LINE'}</WsRow>
        </WsCard>

        {showForm ? (
          <WsForm
            ev={{ slug: ev.slug, title: ev.title, fee: ev.fee, cancelPolicy: ev.cancelPolicy }}
            remaining={remaining}
            preview={preview}
          />
        ) : (
          <WsCard>
            <p className="font-bold">{closedReason}</p>
            <p className="mt-1 text-sm text-[#6b6880]">お問い合わせは{ev.contact || 'BOOM公式LINE'}までどうぞ。</p>
          </WsCard>
        )}

        <p className="pt-4 text-center text-[10px] tracking-[0.3em] text-[#6b6880]">BOOM DANCE SCHOOL</p>
      </div>

      {/* スマホ: 下に固定の申込ボタン(フォームまで飛ぶ) */}
      {showForm && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[#16142b]/10 bg-white/95 px-4 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-3 backdrop-blur md:hidden">
          <div className="mx-auto flex max-w-lg items-center gap-3">
            <div className="shrink-0">
              <p className="f-num text-xl font-bold leading-none">{yen(ev.fee)}</p>
              <p className="text-[11px] text-[#6b6880]">{remaining > 0 ? '先着順' : '満員'}</p>
            </div>
            <a href="#entry-form" className={`flex-1 rounded-full py-3.5 text-center font-bold ${btnPrimaryCls}`}>申し込む</a>
          </div>
        </div>
      )}
    </WsShell>
  );
}
