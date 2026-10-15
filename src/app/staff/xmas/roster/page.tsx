// スタッフ: 会場キャッシャー用の印刷名簿(ふりがなの50音順)。/staff/* 配下のためproxy認証で保護(規約4.5)。
// 載せるのは確定分(支払済み・当日現金)だけ。印刷時はサイドバーなどを隠す。
import StaffPageHeader from '@/components/StaffPageHeader';
import { PARTY_EVENT_KEY, XMAS_EVENT_INFO, formatMembers, rosterRows, summarizePartyOrders, yen } from '@/lib/party';
import { listPartyOrdersStaff } from '@/lib/partyDb';
import PrintButton from './PrintButton';

import { redirect } from 'next/navigation';
import { isAuthorizedServer } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export default async function StaffXmasRosterPage() {
  // proxyはcookieの有無しか見ないため、個人情報を出す前にセッションを本検証する(規約4.5)
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const orders = await listPartyOrdersStaff(PARTY_EVENT_KEY);
  const rows = rosterRows(orders);
  const sum = summarizePartyOrders(orders);
  const printedAt = new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });

  return (
    <div>
      <style>{`@media print {
        [data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-container"], header, .no-print { display: none !important; }
        [data-slot="sidebar-inset"] { margin: 0 !important; }
        body, html { background: #fff !important; }
        @page { size: A4 portrait; margin: 10mm; }
      }`}</style>
      <div className="no-print">
        <StaffPageHeader
          title="キャッシャー用 名簿"
          description="前日に印刷して会場のキャッシャーに渡す。来場したら左の□に✓"
          backHref="/staff/xmas"
          backLabel="クリパ2026"
          rightExtra={<PrintButton />}
        />
      </div>
      <div className="mx-auto max-w-4xl bg-white p-4 text-black print:p-0">
        <h1 className="text-lg font-bold">{XMAS_EVENT_INFO.title} 受付名簿</h1>
        <p className="text-xs">
          {XMAS_EVENT_INFO.dateLabel} {XMAS_EVENT_INFO.venue} ・ 印刷 {printedAt} ・ {rows.length}件
        </p>
        <p className="mt-1 text-sm font-bold">
          当日キャッシャーで受け取る現金(予約分) 合計 {yen(sum.cashDue)} ・ 当日券は別に人数を数えてください
        </p>
        <table className="mt-3 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-black text-left">
              <th className="w-8 py-1">来</th>
              <th className="py-1">ふりがな / お名前</th>
              <th className="py-1">区分</th>
              <th className="py-1 text-right">人数</th>
              <th className="py-1 text-right">お支払い</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id} className="border-b border-neutral-400 align-top" style={{ breakInside: 'avoid' }}>
                <td className="py-1.5">
                  <span className="inline-block h-5 w-5 border-2 border-black" />
                </td>
                <td className="py-1.5">
                  <span className="text-xs">{o.buyerKana}</span>
                  <br />
                  <span className="font-bold">{o.buyerName}</span>
                </td>
                <td className="py-1.5 text-xs">
                  {o.kind === 'entry' ? (
                    <>
                      <b>出演: {o.teamName}({o.teamKana})</b>
                      <br />
                      {formatMembers(o.members)}
                    </>
                  ) : (
                    <>参加{o.isMember === false ? '(会員以外)' : ''}</>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {o.kind === 'entry' ? `出演${o.memberCount}名` : `${o.peopleCount}名`}
                  {o.infantCount > 0 && (
                    <>
                      <br />
                      <span className="text-xs">+未就学{o.infantCount}</span>
                    </>
                  )}
                </td>
                <td className="py-1.5 text-right font-bold">
                  {o.status === 'paid' ? '支払済み' : `当日 ${yen(o.amountTotal)}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs">1ドリンク ¥600 は別途キャッシャーで受け取り。名簿にない方は当日券(人数を数える)。</p>
      </div>
    </div>
  );
}
