'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

// WS O: FAQボットの「エラー報告」仕分け画面。利用者が報告モードで送った指摘を
// 「要修正(fixed)」「エラーではない(not_error)」に振り分ける。報告本文は編集しない。
type Report = {
  id: number;
  at: string;
  content: string;
  context: string | null;
  status: string;
  is_test: number;
};

const FILTERS = [
  { key: 'new', label: '未仕分け' },
  { key: 'all', label: 'すべて' },
] as const;

export default function FaqReportsPage() {
  const [filter, setFilter] = useState<string>('new');
  const [reports, setReports] = useState<Report[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<number | null>(null);

  const load = useCallback(async (f: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/staff/faq/reports?filter=${f}`, { cache: 'no-store' });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      const d = (await r.json()) as { reports: Report[]; counts: { status: string; n: number }[] };
      setReports(d.reports ?? []);
      setCounts(Object.fromEntries((d.counts ?? []).map((c) => [c.status, Number(c.n)])));
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [load, filter]);

  const mark = async (id: number, status: 'fixed' | 'not_error' | 'new') => {
    setSaving(id);
    try {
      const r = await fetch('/api/staff/faq/reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      });
      if (!r.ok) throw new Error('更新に失敗しました');
      await load(filter);
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新に失敗しました');
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="🔧 FAQボット エラー報告"
        description="利用者が「エラー報告」モードで送った指摘。要修正か、エラーでないかを仕分けする"
        backHref="/staff/faq"
        backLabel="FAQ管理へ"
      />

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-4 py-1.5 text-sm border ${
              filter === f.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-2 text-sm text-slate-500">
          未仕分け {counts.new ?? 0} / 要修正 {counts.fixed ?? 0} / エラーでない {counts.not_error ?? 0}
        </span>
      </div>

      {loading && <p className="text-sm text-slate-500">読み込み中…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && reports.length === 0 && (
        <p className="text-sm text-slate-500">
          {filter === 'new' ? '未仕分けの報告はありません👏' : '報告はまだありません'}
        </p>
      )}

      <ul className="space-y-3">
        {reports.map((r) => (
          <li key={r.id} className="rounded-xl border bg-white p-3">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="tabular-nums">{r.at}</span>
              {r.is_test === 1 && (
                <span className="rounded bg-sand-100 px-1.5 py-0.5 text-navy-700">🧪 テスト</span>
              )}
              <span
                className={`rounded px-1.5 py-0.5 ${
                  r.status === 'new'
                    ? 'bg-brand-100 text-brand-800'
                    : r.status === 'fixed'
                      ? 'bg-navy-100 text-navy-700'
                      : 'bg-slate-100 text-slate-500'
                }`}
              >
                {r.status === 'new' ? '未仕分け' : r.status === 'fixed' ? '要修正' : 'エラーでない'}
              </span>
            </div>

            <p className="whitespace-pre-wrap text-sm font-medium text-navy-800">{r.content}</p>

            {r.context && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs text-slate-400">直前のやりとりを見る</summary>
                <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-600">
                  {r.context}
                </pre>
              </details>
            )}

            <div className="mt-2 flex flex-wrap gap-2">
              <button
                disabled={saving === r.id || r.status === 'fixed'}
                onClick={() => mark(r.id, 'fixed')}
                className="rounded-full border bg-white px-3 py-1 text-xs disabled:opacity-40"
              >
                要修正にする
              </button>
              <button
                disabled={saving === r.id || r.status === 'not_error'}
                onClick={() => mark(r.id, 'not_error')}
                className="rounded-full border bg-white px-3 py-1 text-xs disabled:opacity-40"
              >
                エラーではない
              </button>
              {r.status !== 'new' && (
                <button
                  disabled={saving === r.id}
                  onClick={() => mark(r.id, 'new')}
                  className="rounded-full border bg-white px-3 py-1 text-xs text-slate-500 disabled:opacity-40"
                >
                  未仕分けに戻す
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
