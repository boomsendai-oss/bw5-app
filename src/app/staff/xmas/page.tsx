// スタッフ: クリスマスパーティー2026 申込とエントリーの一覧。/staff/* 配下のためproxy認証で保護(規約4.5)。
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';
import {
  ticketOpenAtOf,
  PARTY_EVENT_KEY,
  entryState,
  formatJstLabel,
  formatMembers,
  formatPartyReceiptNo,
  partyStatusLabel,
  summarizePartyOrders,
  ticketCardState,
  ticketCashState,
  yen,
  type GateState,
} from '@/lib/party';
import { CONFIRMATION_RESENT_MARK, ENTRY_TICKET_NOTICE_MARK, countHoldingTeams, getPartySettings, listPartyOrdersStaff } from '@/lib/partyDb';
import OrderActions from './OrderActions';
import AudioReminderButton from './AudioReminderButton';
import EntryTicketNoticeButton from './EntryTicketNoticeButton';
import ConfirmationResendButton from './ConfirmationResendButton';

import { redirect } from 'next/navigation';
import { isAuthorizedServer } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

const GATE_LABEL: Record<GateState, string> = {
  before: '未公開',
  open: '受付中',
  closed: '締切',
  full: '満枠',
  suspended: '停止中',
};

export default async function StaffXmasPage() {
  // proxyはcookieの有無しか見ないため、個人情報を出す前にセッションを本検証する(規約4.5)
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const [orders, s, holding] = await Promise.all([
    listPartyOrdersStaff(PARTY_EVENT_KEY),
    getPartySettings(PARTY_EVENT_KEY),
    countHoldingTeams(PARTY_EVENT_KEY),
  ]);
  const sum = summarizePartyOrders(orders);
  const now = new Date();
  const entries = orders.filter((o) => o.kind === 'entry');
  const tickets = orders.filter((o) => o.kind === 'ticket');

  return (
    <div>
      <StaffPageHeader
        title="クリスマスパーティー2026"
        description={`12/19(土) SPACE ZERO ・ チケット ${ticketOpenAtOf(s) ? formatJstLabel(ticketOpenAtOf(s)) : '未設定'}〜 ・ エントリー ${s.openAt ? formatJstLabel(s.openAt) : '未設定'}〜`}
        rightExtra={
          <div className="flex flex-wrap gap-2 text-sm">
            <HeaderLink href="/staff/xmas/settings">設定</HeaderLink>
            <HeaderLink href="/staff/xmas/roster">名簿(印刷)</HeaderLink>
            <HeaderLink href="/staff/xmas/settlement">精算・収支</HeaderLink>
            <HeaderLink href="/xmas" external>公開ページ</HeaderLink>
          </div>
        }
      />
      <div className="mx-auto max-w-5xl space-y-6 p-4">
        <section className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sand-200 bg-white p-4">
          <p className="text-xs text-neutral-600">
            控えメールのまとめ送り直し(メール設定を直したあとに使う・送った申込には印が付き二度は送らない)
          </p>
          <ConfirmationResendButton
            missing={
              orders.filter(
                (o) => (o.status === 'paid' || o.status === 'cash_due') && !(o.staffNote ?? '').includes(CONFIRMATION_RESENT_MARK)
              ).length
            }
          />
        </section>
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="参加申込" value={`${sum.ticketOrders}件`} sub={`小学生以上${sum.people}人・未就学${sum.infants}人`} />
          <Card label="出演チーム" value={`${sum.teams} / ${s.teamCap}`} sub={`出演者${sum.performers}人`} />
          <Card label="カード支払済み" value={yen(sum.cardPaid)} />
          <Card label="当日現金の予定" value={yen(sum.cashDue)} sub="キャッシャーに入る額" />
        </section>

        <section className="flex flex-wrap gap-2 text-xs">
          <Gate label="カード前売" state={ticketCardState(s, now)} until={s.ticketCardDeadline} />
          <Gate label="当日現金予約" state={ticketCashState(s, now)} until={s.ticketCashDeadline} />
          <Gate label="出演エントリー" state={entryState(s, now, holding)} until={s.entryDeadline} />
          <span className="rounded-full border border-sand-300 bg-white px-3 py-1 text-navy-800">
            来場見込み {sum.headcount}人(+未就学{sum.infants}人)・会員以外の申込 {sum.nonMemberOrders}件
          </span>
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-navy-800">出演エントリー({entries.length}件)</h2>
            <AudioReminderButton missing={entries.filter((o) => (o.status === 'paid' || o.status === 'cash_due') && !o.audioUrl).length} />
            <EntryTicketNoticeButton
              missing={
                entries.filter(
                  (o) =>
                    (o.status === 'paid' || o.status === 'cash_due') &&
                    o.peopleCount < o.memberCount &&
                    !(o.staffNote ?? '').includes(ENTRY_TICKET_NOTICE_MARK)
                ).length
              }
            />
          </div>
          {entries.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">まだありません</p>
          ) : (
            <ul className="mt-3 divide-y divide-sand-100">
              {entries.map((o) => (
                <li key={o.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-neutral-500">{formatPartyReceiptNo(o.id)}</span>
                    <span className="font-bold text-navy-800">{o.teamName}</span>
                    <span className="text-xs text-neutral-600">{o.teamKana}・{o.genre}</span>
                    <StatusBadge status={o.status} />
                    <span className="text-sm text-navy-800">{yen(o.amountTotal)}({o.payMethod === 'card' ? 'カード' : '当日現金'})</span>
                  </div>
                  <p className="mt-1 text-sm text-neutral-700">
                    {o.memberCount}名: {formatMembers(o.members)} ・ 入場チケット{o.peopleCount}枚
                  </p>
                  <p className="text-xs text-neutral-500">
                    代表 {o.buyerName}({o.buyerKana}) {o.phone} {o.email}
                  </p>
                  <p className="mt-1 text-xs">
                    音源:{' '}
                    {o.audioUrl ? (
                      <a href={o.audioUrl} target="_blank" rel="noreferrer" className="font-semibold text-brand-600 underline">
                        {o.audioFilename || 'ダウンロード'}
                      </a>
                    ) : (
                      <span className="font-semibold text-red-600">
                        未提出
                        {o.audioRemindedAt
                          ? `(リマインド送信済み ${new Date(o.audioRemindedAt).toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' })})`
                          : ''}
                      </span>
                    )}
                  </p>
                  <OrderActions id={o.id} status={o.status} note={o.staffNote} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-sand-200 bg-white p-4">
          <h2 className="text-sm font-bold text-navy-800">参加申込({tickets.length}件)</h2>
          {tickets.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500">まだありません</p>
          ) : (
            <ul className="mt-3 divide-y divide-sand-100">
              {tickets.map((o) => (
                <li key={o.id} className="py-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-xs text-neutral-500">{formatPartyReceiptNo(o.id)}</span>
                    <span className="font-bold text-navy-800">{o.buyerName}</span>
                    <span className="text-xs text-neutral-600">{o.buyerKana}</span>
                    <StatusBadge status={o.status} />
                    <span className="text-sm text-navy-800">
                      {o.peopleCount}人{o.infantCount > 0 ? `+未就学${o.infantCount}` : ''} ・ {yen(o.amountTotal)}(
                      {o.payMethod === 'card' ? 'カード' : '当日現金'})
                    </span>
                    <span className="text-xs text-neutral-600">{o.isMember ? '会員' : '会員以外'}</span>
                  </div>
                  <p className="text-xs text-neutral-500">
                    {o.phone} {o.email}
                  </p>
                  <OrderActions id={o.id} status={o.status} note={o.staffNote} />
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs leading-relaxed text-neutral-500">
          取消・返金済みにしてもStripeの返金は自動では行われません。カードの返金はStripeの管理画面で行ってから「返金済み」にしてください。
        </p>
      </div>
    </div>
  );
}

function HeaderLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 font-semibold text-brand-700 hover:bg-sand-50"
    >
      {children}
    </Link>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-xl font-bold text-navy-800">{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}

function Gate({ label, state, until }: { label: string; state: GateState; until: string }) {
  const color = state === 'open' ? 'bg-brand-500 text-white' : 'bg-sand-100 text-navy-800';
  return (
    <span className={`rounded-full px-3 py-1 ${color}`}>
      {label}: {GATE_LABEL[state]}({formatJstLabel(until)}まで)
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'paid'
      ? 'bg-brand-100 text-brand-800'
      : status === 'cash_due'
        ? 'bg-amber-100 text-amber-800'
        : status === 'pending'
          ? 'bg-sky-100 text-sky-800'
          : 'bg-neutral-200 text-neutral-600';
  return <span className={`rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>{partyStatusLabel(status)}</span>;
}
