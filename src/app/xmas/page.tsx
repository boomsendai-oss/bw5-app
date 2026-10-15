// ⚠️ 公開ページ(認証なし)。理由: クリスマスパーティー2026の案内(外部の子も参加可)。
// 表示するのは公開情報(日時・料金・受付状態・残りチーム数)だけで、申込者の情報は出さない。
import Link from 'next/link';
import Image from 'next/image';
import { XMAS_EVENT_INFO, formatJstLabel, yen, type GateState } from '@/lib/party';
import { getXmasContext } from './actions';
import { Panel, Row, XmasShell, greenBtnCls, primaryBtnCls } from './ui';

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

  return (
    <XmasShell>
      <Image
        src="/xmas/flyer.jpg"
        alt="BOOM クリスマスパーティー 2026 ショーケース出演チーム募集"
        width={1080}
        height={1350}
        priority
        className="w-full rounded-xl border-[3px] border-[#1a1410] shadow-[6px_6px_0_#1a1410]"
      />

      <Panel title="開催概要">
        <dl>
          <Row k="日時" v={`${XMAS_EVENT_INFO.dateLabel} ${XMAS_EVENT_INFO.timeLabel}`} />
          <Row k="会場" v={<>{XMAS_EVENT_INFO.venue}<br /><span className="text-xs">{XMAS_EVENT_INFO.venueAddress}</span></>} />
          <Row
            k="参加費"
            v={
              <>
                前売 {yen(s.presalePrice)} / 当日 {yen(s.doorPrice)}
                <br />
                <span className="text-xs">未就学児は無料・{XMAS_EVENT_INFO.drinkLabel}</span>
              </>
            }
          />
          <Row k="対象" v="BOOMの生徒・保護者・お友達(会員以外もOK)" />
          <Row k="お昼" v="持ち込みOK(会場で食べられます)・入退場自由" />
        </dl>
      </Panel>

      <Panel title="企画" tone="green">
        <ul className="space-y-1 text-sm font-bold">
          <li>★ スマブラ大会(賞品あり)</li>
          <li>★ じゃんけん大会(プレゼントあり)</li>
          <li>★ 画伯の絵を当てろ！ゲーム</li>
          <li>★ プチダンスバトル大会</li>
          <li>★ ダンスショーケース</li>
          <li>★ DJタイム・フリータイム</li>
        </ul>
        <p className="mt-2 text-xs font-bold text-neutral-600">※内容は変わる場合があります</p>
      </Panel>

      <Panel title="参加申込(前売)">
        <p className="text-sm font-bold">{stateLine(ticketState, s.openAt, ticketDeadline)}</p>
        <p className="mt-1 text-xs font-bold text-neutral-600">
          カード払い または 当日現金払い。締切後は当日券({yen(s.doorPrice)})を会場でお求めください。
        </p>
        {ticketOpen ? (
          <Link href="/xmas/ticket" className={`mt-4 ${primaryBtnCls}`}>
            参加を申し込む
          </Link>
        ) : null}
      </Panel>

      <Panel title="ショーケース出演エントリー" tone="green">
        <p className="text-sm font-bold">{stateLine(ctx.entry, s.openAt, s.entryDeadline)}</p>
        {ctx.entry === 'open' && <p className="mt-1 text-sm font-black text-[#d4302a]">残り {ctx.teamsLeft} チーム</p>}
        <ul className="mt-2 space-y-1 text-xs font-bold text-neutral-700">
          <li>・2人以上のチーム(1人での出演はなし)・{XMAS_EVENT_INFO.showTimeLimit}・先着順</li>
          <li>・出演料+参加費 1人 {yen(ctx.entryUnit)}(出演メンバーはパーティーの申込不要)</li>
          <li>・音源の提出締切 {formatJstLabel(s.audioDeadline)}</li>
        </ul>
        {ctx.entry === 'open' ? (
          <Link href="/xmas/entry" className={`mt-4 ${greenBtnCls}`}>
            出演エントリーする
          </Link>
        ) : null}
      </Panel>

      <p className="mt-8 text-center text-xs font-bold text-neutral-600">
        お申し込み後は原則として返金できません。お問い合わせは BOOM 公式LINE まで。
      </p>
    </XmasShell>
  );
}
