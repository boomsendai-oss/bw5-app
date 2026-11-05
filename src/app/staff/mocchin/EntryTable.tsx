'use client';

// 申込一覧の表。支払い回ごとの入金チェック・取消の切り替え、定員の変更、CSVの書き出し。
// 文字色は必ず明示する(bodyの既定が白のため・規約11)。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CLASS_NUMBER_LABEL, PAYMENT_PLAN_LABEL, formatMocchinNo, mocchinCsv, mocchinPaySteps, paidStepSet, yen, type ClassNumberPlan, type PaymentPlan } from '@/lib/mocchinEntry';
import type { MocchinEntry } from '@/lib/mocchinEntryDb';
import { saveCapacityAction, setStatusAction, toggleLessonPaidAction, togglePaidAction } from './actions';

function jst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EntryTable({ rows, capacity, today }: { rows: MocchinEntry[]; capacity: number; today: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cap, setCap] = useState(String(capacity));
  const [msg, setMsg] = useState('');

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? '' : r.error ?? 'エラー');
      router.refresh();
    });
  }

  function downloadCsv() {
    const csv = mocchinCsv(rows.map((r) => ({ ...r, createdAt: jst(r.createdAt) })));
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mocchin_entries_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-900">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-neutral-500">定員(超えても受付は続き、申込者にオーディションの可能性を案内)</span>
          <input
            className="mt-1 w-24 rounded-md border border-sand-300 bg-white px-2 py-1 text-slate-900"
            inputMode="numeric"
            value={cap}
            onChange={(e) => setCap(e.target.value)}
          />
        </label>
        <button
          type="button"
          disabled={pending}
          className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
          onClick={() => run(() => saveCapacityAction(Number(cap)))}
        >
          定員を保存
        </button>
        <button type="button" className="ml-auto rounded-md border border-brand-600 px-3 py-1.5 text-sm font-bold text-brand-700" onClick={downloadCsv}>
          CSVを書き出す
        </button>
      </div>
      {msg && <p className="mt-2 text-sm text-red-600">{msg}</p>}

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-neutral-500">まだ申込はありません</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-sand-200 text-left text-xs text-neutral-500">
                <th className="py-1">番号</th>
                <th className="py-1">申込日時</th>
                <th className="py-1">お名前</th>
                <th className="py-1">年齢</th>
                <th className="py-1">会員</th>
                <th className="py-1">連絡先</th>
                <th className="py-1">クラスのナンバー</th>
                <th className="py-1">備考</th>
                <th className="py-1">入金</th>
                <th className="py-1">状態</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={`border-b border-sand-100 align-top ${r.status === 'cancelled' ? 'text-neutral-400 line-through' : ''}`}>
                  <td className="py-1.5 font-mono">{formatMocchinNo(r.id)}</td>
                  <td className="py-1.5 whitespace-nowrap">{jst(r.createdAt)}</td>
                  <td className="py-1.5">
                    {r.name}
                    <span className="block text-xs text-neutral-500">{r.kana}</span>
                    {r.guardianName && <span className="block text-xs text-neutral-500">保護者: {r.guardianName}</span>}
                  </td>
                  <td className="py-1.5">{r.age}</td>
                  <td className="py-1.5">
                    {r.isMember ? '会員' : '会員以外'}
                    {r.memberNo && <span className="block text-xs text-neutral-500">No.{r.memberNo}</span>}
                    {r.danceHistory && <span className="block max-w-[14rem] text-xs text-neutral-500">{r.danceHistory}</span>}
                  </td>
                  <td className="py-1.5 text-xs">
                    {r.phone}
                    <span className="block break-all">{r.email}</span>
                  </td>
                  <td className="py-1.5">{CLASS_NUMBER_LABEL[r.classNumber as ClassNumberPlan] ?? r.classNumber}</td>
                  <td className="py-1.5 max-w-[16rem] text-xs">
                    {r.note}
                    {r.staffNote && <span className="block text-brand-700">[スタッフ] {r.staffNote}</span>}
                  </td>
                  <td className="py-1.5">
                    <span className="mb-1 block max-w-[12rem] text-xs text-neutral-500">{PAYMENT_PLAN_LABEL[r.paymentPlan as PaymentPlan] ?? r.paymentPlan}</span>
                    {mocchinPaySteps(r.paymentPlan, r.isMember, r.appliedOn).map((s) => {
                      const done = paidStepSet(r.paid, r.lessonPaid).has(s.step);
                      const late = !done && r.status === 'active' && today > s.due;
                      return (
                        <label key={s.step} className={`flex items-center gap-1 whitespace-nowrap text-xs ${late ? 'font-bold text-red-600' : ''}`}>
                          <input
                            type="checkbox"
                            checked={done}
                            disabled={pending}
                            onChange={(e) =>
                              run(() => (s.step === 0 ? togglePaidAction(r.id, e.target.checked) : toggleLessonPaidAction(r.id, s.step, e.target.checked)))
                            }
                          />
                          {s.label} {yen(s.amount)}（{s.due.slice(5).replace('-', '/')}まで{late ? '・期限切れ' : ''}）
                        </label>
                      );
                    })}
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      disabled={pending}
                      className="whitespace-nowrap rounded border border-sand-300 px-2 py-0.5 text-xs no-underline"
                      onClick={() => {
                        const next = r.status === 'active' ? 'cancelled' : 'active';
                        if (next === 'cancelled' && !confirm(`${formatMocchinNo(r.id)} を取消にしますか？`)) return;
                        run(() => setStatusAction(r.id, next));
                      }}
                    >
                      {r.status === 'active' ? '取消にする' : '有効に戻す'}
                    </button>
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
