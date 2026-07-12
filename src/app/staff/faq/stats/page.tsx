'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

// WS O: FAQボットの匿名会話ログ集計。何がよく聞かれているか(=お客さんの詰まりポイント)を
// カテゴリ別・日別・生の質問一覧で眺めるための読み取り専用ページ。個人情報は保存していない。
type Row = Record<string, unknown>;
type Stats = {
  byCategory: Row[];
  byDay: Row[];
  recent: Row[];
  totals: { questions?: number | string; sessions?: number | string };
};

const PERIODS = [
  { key: '7', label: '直近7日' },
  { key: '30', label: '直近30日' },
  { key: 'all', label: '全期間' },
] as const;

export default function FaqStatsPage() {
  const [period, setPeriod] = useState<string>('30');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/staff/faq/stats?period=${p}`, { cache: 'no-store' });
      if (!r.ok) {
        const e = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      setStats((await r.json()) as Stats);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました');
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const maxCat = Math.max(1, ...(stats?.byCategory ?? []).map((r) => Number(r.n) || 0));

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="📊 FAQボット 質問ログ集計"
        description="お客さんが何を聞いているか(匿名)。カテゴリはボットが自動分類"
        backHref="/staff/faq"
        backLabel="FAQ管理へ"
      />

      <div className="flex gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => setPeriod(p.key)}
            className={`rounded-full px-4 py-1.5 text-sm border ${
              period === p.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-500">読み込み中…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {stats && !loading && (
        <div className="space-y-6">
          <div className="flex gap-6 text-sm">
            <div className="rounded-lg border bg-white px-4 py-3">
              質問数 <span className="ml-2 text-2xl font-bold">{String(stats.totals.questions ?? 0)}</span>
            </div>
            <div className="rounded-lg border bg-white px-4 py-3">
              利用セッション数 <span className="ml-2 text-2xl font-bold">{String(stats.totals.sessions ?? 0)}</span>
            </div>
          </div>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-3 font-bold">カテゴリ別の質問数</h2>
            {stats.byCategory.length === 0 && <p className="text-sm text-slate-500">データなし</p>}
            <div className="space-y-1.5">
              {stats.byCategory.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <div className="w-28 shrink-0">{String(r.category)}</div>
                  <div className="h-4 rounded bg-teal-600/80" style={{ width: `${(Number(r.n) / maxCat) * 60}%` }} />
                  <div className="tabular-nums">{String(r.n)}</div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              ※分類タグ導入(2026-07-12)以前のログは「未分類」に入ります
            </p>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-3 font-bold">日別の質問数(JST)</h2>
            <table className="text-sm">
              <tbody>
                {stats.byDay.map((r, i) => (
                  <tr key={i}>
                    <td className="pr-4 tabular-nums">{String(r.day)}</td>
                    <td className="tabular-nums">{String(r.n)}件</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="rounded-lg border bg-white p-4">
            <h2 className="mb-1 font-bold">最近の質問(最新50件・匿名)</h2>
            <p className="mb-3 text-xs text-slate-400">
              よく聞かれて答えられていないものはFAQ管理へ追加を。個人情報を見つけたらPMへ削除依頼
            </p>
            <ul className="space-y-2 text-sm">
              {stats.recent.map((r, i) => (
                <li key={i} className="border-b pb-1.5">
                  <span className="mr-2 text-xs text-slate-400 tabular-nums">{String(r.at)}</span>
                  {String(r.content)}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
