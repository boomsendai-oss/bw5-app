// ⚠️ 公開ページ(認証なし)。理由: クリスマスパーティー2026の案内(外部の子も参加可)。
// 表示するのは公開情報(日時・料金・企画・受付状態・残りチーム数)だけで、申込者の情報は出さない。
import Link from 'next/link';
import Image from 'next/image';
import { XMAS_EVENT_INFO, formatJstLabel, yen, type GateState } from '@/lib/party';
import { getXmasContext } from './actions';
import { Panel, Row, XmasShell, greenBtnCls, primaryBtnCls } from './ui';
import { XMAS_FAQ_STATIC, XMAS_MAP_URL, XMAS_PRIZE_LINE, XMAS_PROGRAM, XMAS_TIMETABLE } from './content';
import GahakuQuiz from './GahakuQuiz';
import ResendForm from './ResendForm';

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

export default async function XmasTopPage() {
  const ctx = await getXmasContext();
  const s = ctx.settings;
  const ticketOpen = ctx.ticketCard === 'open' || ctx.ticketCash === 'open';
  const ticketState: GateState = ticketOpen ? 'open' : ctx.ticketCash;
  const ticketDeadline = ctx.ticketCash === 'open' ? s.ticketCashDeadline : s.ticketCardDeadline;
  const beforeOpen = ctx.ticketCash === 'before' && s.openAt;

  const faq = [
    {
      q: '保護者も入場料がかかりますか？',
      a: `小学生以上は1人 前売${yen(s.presalePrice)}(当日${yen(s.doorPrice)})です。未就学児は無料です。`,
    },
    {
      q: '前売の締切を過ぎたら？',
      a: `当日券(${yen(s.doorPrice)})を会場でお求めください。`,
    },
    ...XMAS_FAQ_STATIC,
  ];

  return (
    <XmasShell>
      <Image
        src="/xmas/hero-v3.jpg"
        alt="BOOM クリスマスパーティー 2026 12.19 SAT SPACE ZERO"
        width={1080}
        height={1350}
        priority
        className="w-full rounded-xl border-[3px] border-[#1a1410] shadow-[6px_6px_0_#1a1410]"
      />

      {beforeOpen && (
        <div className="mt-6 -rotate-1 border-[3px] border-[#1a1410] bg-[#f4cf3e] p-3 text-center shadow-[4px_4px_0_#1a1410]">
          <p className="text-sm font-black">チケット予約・出演エントリーは</p>
          <p className="text-2xl font-black">{formatJstLabel(s.openAt)} 受付開始</p>
          <p className="text-xs font-bold">出演は先着順です</p>
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
        <p className="text-sm font-black">{stateLine(ticketState, s.openAt, ticketDeadline)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-600">
          前売 {yen(s.presalePrice)}。カード払い または 当日現金払いを選べます。締切後は当日券({yen(s.doorPrice)})を会場でお求めください。
        </p>
        {ticketOpen ? (
          <Link href="/xmas/ticket" className={`mt-4 ${primaryBtnCls}`}>
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
              ・出演料 1人 {yen(s.performerFee)}(別途 入場料 {yen(s.presalePrice)} がかかります)。カード払いのみ。出演メンバーはチケット予約不要
            </li>
            <li>・リハーサルの時間はありません</li>
            <li>・出演順(第1部/第2部)は締切後に決めます。どちらでも出られるよう予定を空けておいてください</li>
            <li>
              ・エントリー締切 {formatJstLabel(s.entryDeadline)} / 音源は後日提出でOK(締切 {formatJstLabel(s.audioDeadline)})
            </li>
          </ul>
          {ctx.entry === 'open' ? (
            <Link href="/xmas/entry" className={`mt-4 ${greenBtnCls}`}>
              出演エントリーする
            </Link>
          ) : null}
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

      <Panel title="控えのURLをもう一度送る">
        <p className="text-xs font-bold text-neutral-700">
          申込時のメールアドレスを入れると、控えページ(出演チームは音源の提出ページ)のURLを送り直します。
        </p>
        <ResendForm />
      </Panel>

      <p className="mt-8 text-center text-xs font-bold text-neutral-600">お問い合わせは BOOM 公式LINE まで。</p>
    </XmasShell>
  );
}

function Sub({ children }: { children: React.ReactNode }) {
  return <span className="block text-[11px] font-bold leading-snug text-neutral-600">{children}</span>;
}
