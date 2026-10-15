// ⚠️ 公開ページ(認証なし)。理由: クリスマスパーティー2026の案内(外部の子も参加可)。
// 表示するのは公開情報(日時・料金・企画・受付状態・残りチーム数)だけで、申込者の情報は出さない。
import Link from 'next/link';
import Image from 'next/image';
import { XMAS_EVENT_INFO, formatJstLabel, jstLocalToMs, ticketOpenAtOf, yen, type GateState } from '@/lib/party';
import Countdown from './Countdown';
import FloatingCta from './FloatingCta';
import { MicVocal, Ticket } from 'lucide-react';
import { getXmasContext } from './actions';
import { Panel, PreviewBanner, Row, XmasShell, greenBtnCls, primaryBtnCls } from './ui';
import { XMAS_FAQ_STATIC, XMAS_MAP_URL, XMAS_PRIZE_LINE, XMAS_PROGRAM, XMAS_TIMETABLE } from './content';
import { SHOWCASE_ORDER_NOTE } from './content';
import GahakuQuiz from './GahakuQuiz';

export const dynamic = 'force-dynamic';

function stateLine(state: GateState, openAt: string, deadline: string): string {
  switch (state) {
    case 'before':
      return openAt ? `${formatJstLabel(openAt)} 受付開始` : '受付開始は近日お知らせします';
    case 'open':
      return `受付中(${formatJstLabel(deadline)} まで)`;
    case 'full':
      return '定員に達したため受付終了';
    case 'suspended':
      return '現在受付を停止しています';
    default:
      return '受付は終了しました';
  }
}

export default async function XmasTopPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const ctx = await getXmasContext(preview);
  const q = ctx.preview ? `?preview=${preview}` : '';
  const s = ctx.settings;
  const ticketOpen = ctx.ticketCard === 'open' || ctx.ticketCash === 'open';
  const ticketState: GateState = ticketOpen ? 'open' : ctx.ticketCash;
  const ticketDeadline = ctx.ticketCash === 'open' ? s.ticketCashDeadline : s.ticketCardDeadline;
  const ticketOpenAt = ticketOpenAtOf(s);
  const ticketBefore = ctx.ticketCash === 'before' && Boolean(ticketOpenAt);
  const entryBefore = ctx.entry === 'before' && Boolean(s.openAt);
  // チケットとエントリーが同じ時刻に開くなら1つにまとめて案内する
  const sameOpen = ticketBefore && ticketOpenAt === s.openAt;
  const openMs = jstLocalToMs(s.openAt);
  const cashDeadlineMs = (jstLocalToMs(s.ticketCashDeadline) ?? 0) + 60_000;
  const entryDeadlineMs = (jstLocalToMs(s.entryDeadline) ?? 0) + 60_000;

  const faq = [
    {
      q: '保護者も入場料がかかりますか？',
      a: `小学生以上は1人 前売${yen(s.presalePrice)}(当日${yen(s.doorPrice)})です。未就学児は無料です。`,
    },
    {
      q: '出演する人もチケットは必要ですか？',
      a: `必要です。出演料(1人${yen(s.performerFee)})とは別に、出演メンバーも1人ずつチケット予約をお願いします。先にチケットを予約していた人は、そのまま出演エントリーできます。`,
    },
    {
      q: '前売の締切を過ぎたら？',
      a: `当日券(${yen(s.doorPrice)})を会場でお求めください。`,
    },
    ...XMAS_FAQ_STATIC,
  ];

  return (
    <XmasShell>
      {ctx.preview && <PreviewBanner />}
      <Image
        src="/xmas/hero-v7.jpg"
        alt="BOOM クリスマスパーティー 2026 12.19 SAT SPACE ZERO"
        width={1080}
        height={1350}
        priority
        className="w-full rounded-xl border-[3px] border-[#1a1410] shadow-[6px_6px_0_#1a1410]"
      />

      {entryBefore && (
        <div className="mt-6 -rotate-1 border-[3px] border-[#1a1410] bg-[#f4cf3e] p-3 text-center shadow-[4px_4px_0_#1a1410]">
          <p className="text-sm font-black">{sameOpen ? 'チケット予約・出演エントリーは' : 'ショーケース出演エントリーは'}</p>
          <p className="text-2xl font-black">{formatJstLabel(s.openAt)} 受付開始</p>
          {openMs != null && (
            <div className="mt-2">
              <Countdown label="受付開始まで" targetMs={openMs} />
            </div>
          )}
          <p className="mt-2 text-xs font-bold">先着{s.teamCap}チーム。埋まり次第終了なので、出演希望の方はお早めにどうぞ</p>
          {ticketBefore && !sameOpen && (
            <p className="mt-1 text-xs font-bold">チケット予約は {formatJstLabel(ticketOpenAt)} 受付開始</p>
          )}
        </div>
      )}
      {(ctx.ticketCash === 'open' || ctx.entry === 'open') && (
        <div className="mt-6 flex flex-wrap justify-center gap-x-4 gap-y-1 border-[3px] border-[#1a1410] bg-[#f4cf3e] px-3 py-2 text-sm font-black shadow-[4px_4px_0_#1a1410]">
          {ctx.ticketCash === 'open' && <DaysLeft label="前売の締切まで" remainingMs={cashDeadlineMs - ctx.nowMs} />}
          {ctx.entry === 'open' && <DaysLeft label="出演エントリーの締切まで" remainingMs={entryDeadlineMs - ctx.nowMs} />}
        </div>
      )}

      <Panel title="開催概要">
        <dl>
          <Row
            k="日時"
            v={
              <>
                <span className="block text-base font-black">{XMAS_EVENT_INFO.dateLabel}</span>
                <span className="block text-base font-black">{XMAS_EVENT_INFO.timeLabel}</span>
                <Sub>入退場自由</Sub>
              </>
            }
          />
          <Row
            k="会場"
            v={
              <>
                <span className="block text-base font-black">{XMAS_EVENT_INFO.venue}</span>
                <Sub>{XMAS_EVENT_INFO.venueAddress}</Sub>
                <a
                  href={XMAS_MAP_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] font-black text-[#2f8a3e] underline"
                >
                  地図を開く
                </a>
              </>
            }
          />
          <Row
            k="入場料"
            v={
              <>
                <span className="block text-base font-black">
                  前売 {yen(s.presalePrice)} / 当日 {yen(s.doorPrice)}
                </span>
                <Sub>未就学児は無料・{XMAS_EVENT_INFO.drinkLabel}</Sub>
              </>
            }
          />
          <Row
            k="対象"
            v={
              <>
                <span className="block text-base font-black">誰でもOK</span>
                <Sub>BOOMの生徒・保護者・お友達</Sub>
              </>
            }
          />
          <Row
            k="バー"
            v={
              <>
                <span className="block text-base font-black">お酒OK 🍻</span>
                <Sub>バーカウンターでソフトドリンク・お酒を注文できます。みんなで乾杯しましょう</Sub>
              </>
            }
          />
        </dl>
      </Panel>

      <Panel title="企画" tone="green">
        <p className="mb-3 -rotate-1 border-[3px] border-[#1a1410] bg-[#f4cf3e] px-3 py-2 text-center text-base font-black shadow-[3px_3px_0_#1a1410]">
          🎁 {XMAS_PRIZE_LINE}
        </p>
        <ul className="space-y-3">
          {XMAS_PROGRAM.map((p) => (
            <li key={p.title}>
              <p className="text-sm font-black">★ {p.title}</p>
              <p className="pl-4 text-xs font-bold text-neutral-700">{p.body}</p>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="画伯コーナー" tone="green">
        <p className="text-sm font-black">去年の「画伯の絵を当てろ！ゲーム」の絵です。練習問題としてどうぞ。</p>
        <GahakuQuiz />
      </Panel>

      <Panel title="タイムテーブル(予定)">
        <ol>
          {XMAS_TIMETABLE.map((t) => (
            <li key={t.time} className="flex gap-3 border-b border-dashed border-[#1a1410]/30 py-1.5 last:border-0">
              <span className="w-12 shrink-0 font-mono text-sm font-black text-[#d4302a]">{t.time}</span>
              <span className="text-sm font-bold">{t.label}</span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-xs font-bold text-neutral-600">※時間は前後することがあります</p>
      </Panel>

      <Panel title="チケット予約(前売)">
        <p className="text-sm font-black">{stateLine(ticketState, ticketOpenAt, ticketDeadline)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-600">
          前売 {yen(s.presalePrice)}。カード払い または 当日現金払いを選べます。締切後は当日券({yen(s.doorPrice)})を会場でお求めください。
        </p>
        {ticketOpen ? (
          <Link href={`/xmas/ticket${q}`} className={`mt-4 flex items-center justify-center gap-2 ${primaryBtnCls}`}>
            <Ticket className="size-6" strokeWidth={2.5} aria-hidden />
            チケットを予約する
          </Link>
        ) : null}
      </Panel>

      <div className="relative">
        <Panel title="ショーケース出演エントリー" tone="green">
          <p className="text-sm font-black">{stateLine(ctx.entry, s.openAt, s.entryDeadline)}</p>
          {ctx.entry === 'open' && <p className="mt-1 text-sm font-black text-[#d4302a]">残り {ctx.teamsLeft} チーム</p>}
          <ul className="mt-2 space-y-1 text-xs font-bold text-neutral-700">
            <li>
              ・2人以上のチーム(1人での出演はなし)・{XMAS_EVENT_INFO.showTimeLimit}・先着{s.teamCap}チーム
            </li>
            <li>・クラスや学年が違うメンバーでOK。BOOMの生徒ではない友達も参加OK</li>
            <li>
              ・出演料 1人 {yen(s.performerFee)}(カード払いのみ)。入場には、出演メンバーも1人ずつチケット予約が必要です(出演料とは別)
            </li>
            <li>・リハーサルの時間はありません</li>
            <li>・{SHOWCASE_ORDER_NOTE}</li>
            <li>
              ・エントリー締切 {formatJstLabel(s.entryDeadline)} / 音源は後日提出でOK(締切 {formatJstLabel(s.audioDeadline)})
            </li>
          </ul>
          {ctx.entry === 'open' ? (
            <Link href={`/xmas/entry${q}`} className={`mt-4 flex items-center justify-center gap-2 ${greenBtnCls}`}>
              <MicVocal className="size-6" strokeWidth={2.5} aria-hidden />
              出演エントリーする
            </Link>
          ) : null}
          <Link href="/xmas/audio" className="mt-3 block text-center text-xs font-black underline">
            エントリー済みのチームの音源提出はこちら
          </Link>
        </Panel>
        <Image
          src="/xmas/kun_point.png"
          alt=""
          width={401}
          height={480}
          className="pointer-events-none absolute -top-2 right-0 z-10 w-24 rotate-6 drop-shadow-[3px_3px_0_rgba(26,20,16,0.35)]"
        />
      </div>

      <Panel title="よくある質問">
        <dl className="space-y-3">
          {faq.map((f) => (
            <div key={f.q}>
              <dt className="text-sm font-black">Q. {f.q}</dt>
              <dd className="pl-4 text-xs font-bold text-neutral-700">A. {f.a}</dd>
            </div>
          ))}
        </dl>
      </Panel>

      <Link
        href="/xmas/audio"
        className="mt-6 block rounded-xl border-[3px] border-[#1a1410] bg-[#2f8a3e] px-4 py-4 text-center text-white shadow-[5px_5px_0_#1a1410] active:translate-y-[2px]"
      >
        <span className="block text-lg font-black">ショーケースに出演される方へ</span>
        <span className="block text-xs font-bold">音源の提出はこちら</span>
      </Link>

      <p className="mt-8 text-center text-xs font-bold text-neutral-600">お問い合わせは BOOM 公式LINE まで。</p>
      {/* 下に浮かぶボタンの分だけ余白を空け、最後の文が隠れないようにする */}
      {(ticketOpen || ctx.entry === 'open') && <div className="h-24" aria-hidden />}
      <FloatingCta
        ticketHref={ticketOpen ? `/xmas/ticket${q}` : undefined}
        entryHref={ctx.entry === 'open' ? `/xmas/entry${q}` : undefined}
      />
    </XmasShell>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-bold leading-snug text-neutral-600">{children}</span>;
}

/** 受付中の締切は「あと○日」だけ出す(秒まで出すのは受付開始前のカウントダウンだけ)。 */
function DaysLeft({ label, remainingMs }: { label: string; remainingMs: number }) {
  if (remainingMs <= 0) return null;
  const days = Math.floor(remainingMs / 86_400_000);
  return (
    <span>
      {label} {days >= 1 ? <span className="text-lg text-[#d4302a]">あと{days}日</span> : <span className="text-lg text-[#d4302a]">本日まで</span>}
    </span>
  );
}
