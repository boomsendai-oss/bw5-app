'use client';

import { useEffect, useState, use as usePromise } from 'react';
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

export default function SharedRosterPage({ params }: { params: Promise<{ code: string; token: string }> }) {
  const { code, token } = usePromise(params);
  const [res, setRes] = useState<SharedRosterResult | null>(null);

  useEffect(() => {
    (async () => setRes(await getSharedRosterAction(code, token)))();
  }, [code, token]);

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
          </div>
        </section>

        {/* パート別 名簿 */}
        {r.parts.map((part) => {
          const members = r.signups.flatMap((s) =>
            s.performers.filter((p) => (p.parts as string[]).includes(part.key)).map((p) => p.name)
          );
          return (
            <section key={part.key} className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`size-2.5 rounded-full ${partDot(part.key)}`} />
                <h2 className="text-sm font-bold text-slate-800">{part.label}</h2>
                <span className="text-xs text-slate-400">{members.length}名</span>
              </div>
              {members.length === 0 ? (
                <div className="text-xs text-slate-400">まだいません</div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {members.map((n, i) => (
                    <span key={i} className="text-sm bg-slate-50 border border-slate-200 rounded-full px-3 py-1 text-slate-700">
                      {n}
                    </span>
                  ))}
                </div>
              )}
            </section>
          );
        })}

        <p className="text-center text-[11px] text-slate-400 px-4">
          このページは閲覧のみです。編集はできません。名簿には個人情報が含まれるため、リンクの共有は関係者のみにお願いします。
        </p>
      </div>
    </div>
  );
}
