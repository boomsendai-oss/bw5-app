'use client';

// 申込一覧の表。会員の要確認の判断、銀行振込の入金確認、取消。
// 文字色は必ず明示する(bodyの既定が白のため・規約11)。
import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bf7WsMemberDiff, bf7WsPayDeadline, bf7WsTransferPrefix, formatBf7WsDate, formatBf7WsNo, yenBf7Ws } from '@/lib/bf7Workshop';
import type { StaffBf7WsOrder } from '@/lib/bf7WorkshopDb';
import { cancelOrderAction, setMemberCheckAction, setTransferReceivedAction } from './actions';

const btn = 'rounded-md border border-sand-300 bg-white px-2 py-1 text-xs font-bold text-brand-700 hover:bg-sand-50 disabled:opacity-50';

function jst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const PAY_LABEL: Record<StaffBf7WsOrder['paymentStatus'], string> = {
  pending: '決済待ち',
  paid: '受取済み',
  transfer_due: '振込待ち',
  expired: '期限切れ',
  canceled: '取消',
};

export default function OrderTable({ rows, today }: { rows: StaffBf7WsOrder[]; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState('');
  const [showDead, setShowDead] = useState(false);

  function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? '' : (r.error ?? 'エラー'));
      router.refresh();
    });
  }

  const isDead = (r: StaffBf7WsOrder) => r.paymentStatus === 'expired' || r.paymentStatus === 'canceled';
  const shown = rows.filter((r) => showDead || !isDead(r));
  const deadCount = rows.length - rows.filter((r) => !isDead(r)).length;

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-900">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold">申込 {rows.length - deadCount}件</h2>
        {deadCount > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-neutral-600">
            <input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} />
            期限切れ・取消も表示({deadCount}件)
          </label>
        )}
      </div>
      {msg && <p className="mt-2 rounded-md bg-red-50 p-2 text-xs font-bold text-red-700">{msg}</p>}
      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-neutral-500">まだ申込はありません。</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-sand-200 text-xs text-neutral-500">
              <tr>
                <th className="py-2 pr-3 font-bold">番号</th>
                <th className="py-2 pr-3 font-bold">受講者</th>
                <th className="py-2 pr-3 font-bold">連絡先</th>
                <th className="py-2 pr-3 font-bold">クラス</th>
                <th className="py-2 pr-3 font-bold">会員の確認</th>
                <th className="py-2 pr-3 font-bold">支払い</th>
                <th className="py-2 font-bold">操作</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={`border-b border-sand-100 align-top ${isDead(r) ? 'text-neutral-400' : ''}`}>
                  <td className="py-2.5 pr-3 tabular-nums">
                    <span className="whitespace-nowrap font-bold">{formatBf7WsNo(r.id)}</span>
                    {r.isTest && <span className="ml-1 whitespace-nowrap rounded bg-amber-100 px-1 text-[10px] font-bold text-amber-800">テスト</span>}
                    <span className="block text-xs text-neutral-500">{jst(r.createdAt)}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className="font-bold">{r.name}</span>
                    <span className="block text-xs text-neutral-500">{r.kana} ・ {r.age}</span>
                    {r.guardianName && <span className="block text-xs text-neutral-500">保護者: {r.guardianName}</span>}
                    {r.note && <span className="mt-1 block text-xs text-neutral-700">備考: {r.note}</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    <span className="block">{r.phone}</span>
                    <span className="block break-all">{r.email}</span>
                  </td>
                  <td className="py-2.5 pr-3 text-xs font-bold">
                    {r.first && <span className="block">1本目</span>}
                    {r.second && <span className="block">2本目</span>}
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    <MemberCell r={r} busy={pending} onSet={(c) => act(() => setMemberCheckAction(r.id, c))} />
                  </td>
                  <td className="py-2.5 pr-3 text-xs">
                    <span className="block font-bold tabular-nums">{yenBf7Ws(r.amountTotal)}</span>
                    <span className="block">{r.payMethod === 'prepaid' ? 'カード' : '銀行振込'} ・ {PAY_LABEL[r.paymentStatus]}</span>
                    {r.paymentStatus === 'transfer_due' && (
                      <span className="block text-neutral-500">
                        名義 {bf7WsTransferPrefix(r.id)} ・ 期限 {formatBf7WsDate(bf7WsPayDeadline(r.appliedOn))}
                        {today > bf7WsPayDeadline(r.appliedOn) && <span className="ml-1 rounded bg-red-50 px-1 font-bold text-red-700">期限切れ</span>}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5">
                    {!isDead(r) && (
                      <div className="flex flex-wrap gap-1">
                        {r.paymentStatus === 'transfer_due' && (
                          <button
                            className={btn}
                            disabled={pending}
                            onClick={() => {
                              if (window.confirm(`${formatBf7WsNo(r.id)} の入金を確認済みにします。本人に確定メールが届きます。`)) act(() => setTransferReceivedAction(r.id, true));
                            }}
                          >
                            入金を確認した
                          </button>
                        )}
                        {r.paymentStatus === 'paid' && r.payMethod === 'transfer' && (
                          <button className={btn} disabled={pending} onClick={() => act(() => setTransferReceivedAction(r.id, false))}>
                            入金確認を戻す
                          </button>
                        )}
                        <button
                          className={btn}
                          disabled={pending}
                          onClick={() => {
                            const refund = r.paymentStatus === 'paid' ? '\n返金は、ここでは行われません(カードはStripeの画面、振込は別途お振込みで行います)。' : '';
                            if (window.confirm(`${formatBf7WsNo(r.id)} を取り消します。枠が1つ空きます。${refund}`)) act(() => cancelOrderAction(r.id));
                          }}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function MemberCell({ r, busy, onSet }: { r: StaffBf7WsOrder; busy: boolean; onSet: (c: 'confirmed' | 'rejected') => void }) {
  if (!r.isMember) return <span className="text-neutral-500">一般(申告)</span>;
  if (r.memberCheck === 'confirmed') {
    return (
      <span>
        <span className="rounded bg-brand-50 px-1.5 py-0.5 font-bold text-brand-700">会員 確認済み</span>
        {r.matchedName && <span className="mt-1 block text-neutral-500">{r.matchedName}</span>}
      </span>
    );
  }
  if (r.memberCheck === 'rejected') {
    return (
      <span>
        <span className="rounded bg-red-50 px-1.5 py-0.5 font-bold text-red-700">会員ではない</span>
        <span className="mt-1 block font-bold text-red-700">差額 {yenBf7Ws(bf7WsMemberDiff(r.first, r.second))} を連絡して請求</span>
        <button className={`${btn} mt-1`} disabled={busy} onClick={() => onSet('confirmed')}>
          会員に戻す
        </button>
      </span>
    );
  }
  return (
    <span>
      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">要確認</span>
      {r.candidates.length > 0 ? (
        <span className="mt-1 block text-neutral-600">
          候補:
          {r.candidates.map((c) => (
            <span key={c.id} className="block">
              {c.name}({c.kana}){c.status !== 'active' && ' ・ 退会'}
              {c.repName && ` ・ 保護者 ${c.repName}`}
            </span>
          ))}
        </span>
      ) : (
        <span className="mt-1 block text-neutral-600">会員データに一致なし</span>
      )}
      <span className="mt-1 flex flex-wrap gap-1">
        <button className={btn} disabled={busy} onClick={() => onSet('confirmed')}>
          会員です
        </button>
        <button className={btn} disabled={busy} onClick={() => onSet('rejected')}>
          会員ではない
        </button>
      </span>
    </span>
  );
}
