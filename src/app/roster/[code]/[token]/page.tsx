'use client';

import { useEffect, useMemo, useState, use as usePromise } from 'react';
import { getSharedRosterAction, type SharedRosterResult } from './actions';

// パート色（集計画面と統一）
const PART_PILL: Record<string, string> = {
  girls_hh: 'bg-rose-50 text-rose-700 border-rose-200',
  waack: 'bg-violet-50 text-violet-700 border-violet-200',
  hiphop: 'bg-sky-50 text-sky-700 border-sky-200',
};
const PART_DOT: Record<string, string> = {
  girls_hh: 'bg-rose-400',
  waack: 'bg-violet-400',
  hiphop: 'bg-sky-400',
};
const partPill = (k: string) => PART_PILL[k] ?? 'bg-slate-100 text-slate-600 border-slate-200';
const partDot = (k: string) => PART_DOT[k] ?? 'bg-slate-400';

function availBadge(a: 'yes' | 'no' | null | undefined) {
  if (a === 'yes') return { cls: 'bg-emerald-50 text-emerald-700 border-emerald-300', label: '9/26◯' };
  if (a === 'no') return { cls: 'bg-rose-50 text-rose-700 border-rose-300', label: '9/26✕' };
  return { cls: 'bg-amber-50 text-amber-700 border-amber-300', label: '未回答' };
}

export default function SharedRosterPage({ params }: { params: Promise<{ code: string; token: string }> }) {
  const { code, token } = usePromise(params);
  const [res, setRes] = useState<SharedRosterResult | null>(null);
  const [tab, setTab] = useState<string>('all'); // 'all' | part.key

  useEffect(() => {
    (async () => setRes(await getSharedRosterAction(code, token)))();
  }, [code, token]);

  // 全出演者を平坦化（名前+パート）
  const allPerformers = useMemo(() => {
    if (!res || !res.ok) return [];
    return res.roster.signups.flatMap((s) => s.performers);
  }, [res]);

  if (!res) {
    return <div className="min-h-screen flex items-center justify-center text-slate-400">読み込み中…</div>;
  }
  if (!res.ok) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center text-slate-500">
        {res.error}
      </div>
    );
  }

  const r = res.roster;
  const shown =
    tab === 'all' ? allPerformers : allPerformers.filter((p) => (p.parts as string[]).includes(tab));
  const labelOf = (k: string) => r.parts.find((p) => p.key === k)?.label ?? k;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-bold text-slate-800">{r.eventName}</h1>
          <p className="text-xs text-slate-400 mt-0.5">出演者名簿（講師共有・閲覧のみ）</p>
        </div>

        {/* サマリー */}
        <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="flex items-end gap-1.5">
              <span className="text-2xl font-bold text-slate-800 tabular-nums leading-none">{r.summary.performerCount}</span>
              <span className="text-xs text-slate-400 mb-0.5">名</span>
            </div>
            <div className="w-px h-7 bg-slate-200" />
            <div className="flex flex-wrap items-center gap-2">
              {r.summary.byPart.map((p) => (
                <div key={p.key} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 ${partPill(p.key)}`}>
                  <span className={`size-2 rounded-full ${partDot(p.key)}`} />
                  <span className="text-xs font-bold">{p.label}</span>
                  <span className="text-sm font-bold tabular-nums">{p.count}</span>
                </div>
              ))}
            </div>
            <div className="w-full flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="font-bold text-emerald-700">9/26 出られる {allPerformers.filter((p) => p.availability === 'yes').length}</span>
              <span className="font-bold text-rose-700">出られない {allPerformers.filter((p) => p.availability === 'no').length}</span>
              <span className="font-bold text-amber-700">未回答 {allPerformers.filter((p) => p.availability == null).length}</span>
            </div>
          </div>
        </section>

        {/* タブ */}
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            onClick={() => setTab('all')}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold border transition ${
              tab === 'all' ? 'bg-navy-700 text-white border-navy-700' : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            全体 <span className="tabular-nums">{r.summary.performerCount}</span>
          </button>
          {r.parts.map((p) => {
            const c = r.summary.byPart.find((b) => b.key === p.key)?.count ?? 0;
            const on = tab === p.key;
            return (
              <button
                key={p.key}
                onClick={() => setTab(p.key)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold border transition ${
                  on ? `${partPill(p.key)} ring-1 ring-inset` : 'bg-white text-slate-600 border-slate-300'
                }`}
              >
                {p.label} <span className="tabular-nums">{c}</span>
              </button>
            );
          })}
        </div>

        {/* 名簿 */}
        <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          {shown.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-400">
              {allPerformers.length === 0 ? 'まだ申込がありません' : 'このパートの出演者はいません'}
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {shown.map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-slate-400 tabular-nums w-5 shrink-0">{i + 1}</span>
                    <span className="text-sm font-semibold text-slate-800">{p.name}</span>
                  </div>
                  <div className="flex flex-wrap gap-1 justify-end shrink-0 items-center">
                    <span className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${availBadge(p.availability).cls}`}>
                      {availBadge(p.availability).label}
                    </span>
                    {p.parts.map((k) => (
                      <span key={k} className={`text-[10px] font-bold rounded-full border px-2 py-0.5 ${partPill(k)}`}>
                        {labelOf(k)}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-center text-[11px] text-slate-400 px-4">
          このページは閲覧のみです。編集はできません。名簿には個人情報が含まれるため、リンクの共有は関係者のみにお願いします。
        </p>
      </div>
    </div>
  );
}
