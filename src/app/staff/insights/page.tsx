'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronLeft, ChevronRight, Target, Upload, TrendingUp, TrendingDown, Users, Sprout, DollarSign, Crosshair, Gem, BarChart3, Plus, RefreshCw, FileText } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { yen } from '@/lib/utils';

type TrendData = {
  months: string[];
  revenue: number[];
  members_active: number[];
  line_friends: number[];
  churn_rate: number[];
  utilization: number[];
  generated_at: string;
};

type TrendPoint = { month: string; value: number };

function ymToShort(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y.slice(2)}/${m}`;
}

function trendPoints(months: string[], values: number[]): TrendPoint[] {
  return months.map((m, i) => ({ month: ymToShort(m), value: values[i] ?? 0 }));
}

function deltaLabel(values: number[], suffix: string, isPct: boolean): { latest: string; delta: string; positive: boolean } {
  const latest = values[values.length - 1] ?? 0;
  const prev = values[values.length - 2] ?? 0;
  const latestStr = isPct ? `${latest.toFixed(1)}${suffix}` : `${num(Math.round(latest))}${suffix}`;
  if (prev === 0) return { latest: latestStr, delta: '—', positive: latest >= 0 };
  const diff = ((latest - prev) / Math.abs(prev)) * 100;
  const sign = diff >= 0 ? '+' : '';
  return { latest: latestStr, delta: `${sign}${diff.toFixed(1)}%`, positive: diff >= 0 };
}

function TrendChart({ title, values, months, suffix, isPct, lowerIsBetter }: {
  title: string;
  values: number[];
  months: string[];
  suffix: string;
  isPct: boolean;
  lowerIsBetter?: boolean;
}) {
  const data = trendPoints(months, values);
  const { latest, delta, positive } = deltaLabel(values, suffix, isPct);
  const good = lowerIsBetter ? !positive : positive;
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-baseline justify-between mb-1">
          <div className="text-[11px] text-neutral-500 font-medium">{title}</div>
          <div className="text-[10px] font-mono text-neutral-400">{delta}</div>
        </div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-lg font-bold text-orange-700">{latest}</span>
          <span className={`text-[10px] font-semibold ${good ? 'text-green-600' : 'text-red-600'}`}>
            {delta !== '—' ? (positive ? <TrendingUp className="inline h-3 w-3" /> : <TrendingDown className="inline h-3 w-3" />) : ''}
          </span>
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
              <Tooltip
                contentStyle={{ fontSize: 11, padding: '4px 8px' }}
                formatter={(v) => {
                  const num1 = typeof v === 'number' ? v : Number(v);
                  return isPct ? `${num1.toFixed(1)}${suffix}` : `${num(Math.round(num1))}${suffix}`;
                }}
              />
              <Line type="monotone" dataKey="value" stroke="#f97316" strokeWidth={2} dot={{ r: 3, fill: '#f97316' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}

type DashboardData = {
  year_month: string;
  prev_year_month: string;
  period: { start: string; end: string };
  members: {
    start_active: number; end_active: number; new_signups: number;
    regular_active?: number; ticket_active?: number; college_active?: number;
    ticket_engaged?: number; ticket_dormant?: number;
    churned: number; net_growth: number; churn_rate: number;
  };
  trial: { count: number; enrolled_within_14d: number; cvr: number };
  line: { friends_now: number; blocked: number; total: number; block_rate: number };
  revenue: {
    core: number;
    breakdown: { plan: number; ticket: number; enrollment_fee: number; other: number };
    arpu: number;
    data_available: boolean;
  };
  aux_revenue: { merch_orders: number; video_preorders_estimate: number; video_preorder_count: number };
  utilization: {
    average: number; lesson_count: number;
    top_classes: Array<{ program_name: string; staff_name: string; avg_rate: number; cnt: number }>;
    bottom_classes: Array<{ program_name: string; staff_name: string; avg_rate: number; cnt: number }>;
    data_available: boolean;
    rate_basis?: string;
    low_threshold?: number;
    grace_months?: number;
    new_classes?: Array<{ program_name: string; staff_name: string; avg_rate: number; cnt: number; launched_at?: string }>;
    watch_classes?: Array<{ program_name: string; staff_name: string; avg_rate: number; cnt: number }>;
    excluded_classes?: Array<{ program_name: string; staff_name: string; avg_rate: number; cnt: number }>;
  };
  profitability: {
    revenue: number; payroll: number; studio: number;
    expense_breakdown: Record<string, number>;
    total_expenses: number; operating_profit: number; profit_margin: number;
    source_availability?: { revenue: boolean; payroll: boolean; studio: boolean; expenses: boolean };
    missing_sources?: string[];
    profit_confirmed?: boolean;
  };
  targets: Record<string, number>;
  generated_at: string;
};

// 同期鮮度バッジ (T-165): 最終同期と稼働率データの古さを常時表示
function SyncFreshness() {
  const [health, setHealth] = useState<{
    last_run: { ran_at: string; status: string; lstep_state_age_days: number | null } | null;
    utilization_last_date: string | null;
  } | null>(null);
  useEffect(() => {
    fetch('/api/staff/operations/sync-health', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setHealth)
      .catch(() => {});
  }, []);
  if (!health) return null;
  const daysAgo = (d: string | null) => {
    if (!d) return null;
    return Math.floor((Date.now() - new Date(d.replace(' ', 'T') + (d.includes('T') || d.includes('+') ? '' : 'Z')).getTime()) / 86400000);
  };
  const runAge = daysAgo(health.last_run?.ran_at ?? null);
  const utilAge = daysAgo(health.utilization_last_date);
  const failed = health.last_run?.status === 'error';
  const stale = runAge !== null && runAge >= 2;
  const utilStale = utilAge !== null && utilAge >= 7;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
      <span className={`rounded-full px-2 py-0.5 font-medium ${failed ? 'bg-red-100 text-red-700' : stale ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
        {health.last_run
          ? `同期: ${failed ? '❌失敗' : '✅成功'} ${runAge === 0 ? '今日' : `${runAge}日前`}`
          : '同期記録なし'}
      </span>
      {health.utilization_last_date && (
        <span className={`rounded-full px-2 py-0.5 font-medium ${utilStale ? 'bg-yellow-100 text-yellow-700' : 'bg-neutral-100 text-neutral-500'}`}>
          稼働率データ: 〜{health.utilization_last_date}{utilStale ? ' ⚠️古い' : ''}
        </span>
      )}
      {(health.last_run?.lstep_state_age_days ?? 0) >= 20 && (
        <span className="rounded-full bg-yellow-100 px-2 py-0.5 font-medium text-yellow-700">
          🔑 Lstepセッション {health.last_run!.lstep_state_age_days}日経過
        </span>
      )}
    </div>
  );
}

function num(n: number): string { return n.toLocaleString('ja-JP'); }
function pct(n: number, decimals = 1): string { return `${n.toFixed(decimals)}%`; }

function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// "2026-05" -> "2026年5月"
function ymJp(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return `${y}年${m}月`;
}

function shiftYM(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

type KpiCardProps = {
  label: string;
  value: string;
  sub?: string;
  target?: number;
  current?: number;
  unit?: string;
  accent?: 'orange' | 'blue' | 'green' | 'red' | 'purple' | 'neutral';
  warn?: boolean;
};

function KpiCard({ label, value, sub, target, current, unit, accent = 'orange', warn }: KpiCardProps) {
  const palette: Record<string, string> = {
    orange: 'text-orange-700',
    blue: 'text-blue-700',
    green: 'text-green-700',
    red: 'text-red-700',
    purple: 'text-purple-700',
    neutral: 'text-neutral-500',
  };
  const progress = target && current !== undefined ? Math.min(100, (current / target) * 100) : null;
  return (
    <Card className={warn ? 'border-red-300' : ''}>
      <CardContent className="p-3">
        <div className="text-[11px] text-neutral-500 font-medium">{label}</div>
        <div className={`text-2xl font-bold mt-1 ${warn ? 'text-red-700' : palette[accent]}`}>{value}</div>
        {sub && <div className="text-[11px] text-neutral-500 mt-1">{sub}</div>}
        {progress !== null && target && (
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-neutral-500 mb-0.5">
              <span>目標: {num(target)}{unit ?? ''}</span>
              <span>{pct(progress, 0)}</span>
            </div>
            <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
              <div className={`h-full ${progress >= 100 ? 'bg-green-500' : progress >= 70 ? 'bg-orange-500' : 'bg-amber-500'}`} style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Section({ title, icon, hint, children }: { title: string; icon?: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base sm:text-lg font-bold text-neutral-800 flex items-center gap-1.5">
          {icon}{title}
        </h2>
        {hint && <span className="text-[10px] text-neutral-400">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const TARGET_LABELS: Record<string, { label: string; unit: string; placeholder: string }> = {
  members_active: { label: '在籍数', unit: '人', placeholder: '100' },
  monthly_revenue: { label: '月次売上', unit: '円', placeholder: '3000000' },
  line_friends: { label: 'LINE友だち', unit: '人', placeholder: '500' },
  trial_count: { label: '体験申込数', unit: '件', placeholder: '20' },
  trial_cvr: { label: '体験CVR', unit: '%', placeholder: '50' },
  utilization: { label: '平均稼働率', unit: '%', placeholder: '70' },
  churn_rate: { label: '退会率(上限)', unit: '%', placeholder: '3' },
  operating_profit: { label: '営業利益', unit: '円', placeholder: '500000' },
};

export default function InsightsPage() {
  const [ym, setYm] = useState(currentYM());
  const [data, setData] = useState<DashboardData | null>(null);
  const [trends, setTrends] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [targetForm, setTargetForm] = useState<Record<string, string>>({});
  const [autoBusy, setAutoBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState('');

  // GA4 LINEクリック (lib/ga4側で1hキャッシュ。GA4自体が数時間〜1日遅れ)
  type LineClickRange = { days: number; total: number; ads: number; est_cpa_jpy: number | null };
  const [lineClicks, setLineClicks] = useState<{ ok: boolean; error?: string; ranges: LineClickRange[] } | null>(null);
  useEffect(() => {
    fetch('/api/staff/insights/line-clicks', { credentials: 'include' })
      .then((r) => r.json())
      .then(setLineClicks)
      .catch(() => setLineClicks({ ok: false, ranges: [] }));
  }, []);

  const runAutoSnapshot = async () => {
    setAutoBusy(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/staff/operations/snapshot-kpi', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/insights';
        return;
      }
      const d = await res.json();
      if (!res.ok) {
        setActionMessage(`失敗: ${d?.error ?? res.statusText}`);
      } else {
        setActionMessage(`${d.snapshot_date} の KPI を自動集計しました`);
        load(ym);
      }
    } catch (e) {
      setActionMessage(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAutoBusy(false);
    }
  };

  const generateMonthlyReport = async () => {
    setReportBusy(true);
    setActionMessage('');
    try {
      const res = await fetch('/api/staff/operations/monthly-report', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/insights';
        return;
      }
      const d = await res.json();
      if (!res.ok) {
        setActionMessage(`レポート生成失敗: ${d?.error ?? res.statusText}`);
      } else {
        setActionMessage(`${d.year_month} の月次レポートを生成しました`);
      }
    } catch (e) {
      setActionMessage(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReportBusy(false);
    }
  };

  const openTargets = async () => {
    const res = await fetch(`/api/staff/kpi/targets?year_month=${ym}`, { credentials: 'include' });
    if (res.ok) {
      const d = await res.json();
      const form: Record<string, string> = {};
      for (const [k, v] of Object.entries(d.targets as Record<string, number>)) form[k] = String(v);
      setTargetForm(form);
      setShowTargets(true);
    }
  };

  const saveTargets = async () => {
    const targets: Record<string, number> = {};
    for (const [k, v] of Object.entries(targetForm)) {
      const n = parseFloat(v);
      if (!isNaN(n)) targets[k] = n;
    }
    const res = await fetch('/api/staff/kpi/targets', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ year_month: ym, targets }),
    });
    if (res.ok) {
      setShowTargets(false);
      const r = await fetch(`/api/staff/kpi/dashboard?year_month=${ym}`, { credentials: 'include' });
      if (r.ok) setData(await r.json());
    }
  };

  const uploadCsv = async (endpoint: string, label: string, file: File) => {
    setUploading(true);
    setErr('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(endpoint, { method: 'POST', credentials: 'include', body: fd });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const result = await res.json();
      alert(`${label}取込完了: ${result.imported}件取込 / ${result.skipped}件スキップ`);
      const r = await fetch(`/api/staff/kpi/dashboard?year_month=${ym}`, { credentials: 'include' });
      if (r.ok) setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/staff/kpi/dashboard?year_month=${target}`, { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/insights';
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(ym); }, [ym, load]);

  const loadTrends = useCallback(async () => {
    try {
      const res = await fetch(`/api/staff/kpi/trends?months=6`, { credentials: 'include' });
      if (!res.ok) return;
      const d: TrendData = await res.json();
      setTrends(d);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => { loadTrends(); }, [loadTrends]);

  const target = data?.targets ?? {};

  const utilColor = useMemo(() => {
    const r = data?.utilization.average ?? 0;
    if (r >= 0.8) return 'green';
    if (r >= 0.5) return 'orange';
    return 'red';
  }, [data]);

  return (
    <main className="text-neutral-900">
      <div className="border-b bg-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-neutral-800 flex items-center gap-1.5">
              <BarChart3 className="h-5 w-5 text-orange-500" />
              経営インサイト
            </h1>
            <p className="text-xs text-neutral-500">月次KPI自動集計ダッシュボード</p>
            <SyncFreshness />
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <Button variant="outline" size="sm" className="text-xs relative" disabled={uploading} asChild>
              <label className="cursor-pointer" title="HACOMONO RS002 固定枠：レッスン別予約集計 CSV">
                <Upload className="h-3 w-3 mr-1" />
                {uploading ? '取込中...' : '稼働率CSV'}
                <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadCsv('/api/staff/kpi/import-rs002', '稼働率', f);
                  e.target.value = '';
                }} />
              </label>
            </Button>
            <Button variant="outline" size="sm" className="text-xs relative" disabled={uploading} asChild>
              <label className="cursor-pointer" title="HACOMONO 課金明細 CSV">
                <Upload className="h-3 w-3 mr-1" />
                課金明細
                <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadCsv('/api/staff/kpi/import-hacomono-billing', 'HACOMONO課金明細', f);
                  e.target.value = '';
                }} />
              </label>
            </Button>
            <Button variant="outline" size="sm" className="text-xs relative" disabled={uploading} asChild>
              <label className="cursor-pointer" title="GMO青空ネット銀行 取引CSV">
                <Upload className="h-3 w-3 mr-1" />
                銀行CSV
                <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) uploadCsv('/api/staff/kpi/import-bank', '銀行明細', f);
                  e.target.value = '';
                }} />
              </label>
            </Button>
            <Button
              onClick={runAutoSnapshot}
              disabled={autoBusy}
              size="sm"
              className="bg-blue-500 hover:bg-blue-600 text-white"
            >
              <RefreshCw className={`h-3 w-3 mr-1 ${autoBusy ? 'animate-spin' : ''}`} />
              {autoBusy ? '集計中...' : '最新KPI自動集計'}
            </Button>
            <Button
              onClick={generateMonthlyReport}
              disabled={reportBusy}
              size="sm"
              className="bg-purple-500 hover:bg-purple-600 text-white"
            >
              <FileText className="h-3 w-3 mr-1" />
              {reportBusy ? '生成中...' : '月次レポート生成'}
            </Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600 text-white" asChild>
              <Link href="/staff/insights/input">
                <Plus className="h-3 w-3 mr-1" />
                月次データを追加
              </Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setYm(shiftYM(ym, -1))}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="text-sm font-bold text-orange-700 px-2">{ym}</span>
            <Button variant="ghost" size="sm" onClick={() => setYm(shiftYM(ym, 1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => setYm(currentYM())}>今月</Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={openTargets}>
              <Target className="h-3 w-3 mr-1" />
              目標
            </Button>
          </div>
        </div>
      </div>

      {actionMessage && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 text-sm text-blue-800">
          {actionMessage}
        </div>
      )}

      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">読込エラー: {err}</div>}
        {loading && <p className="text-slate-500 text-sm py-4">読込中...</p>}

        {data && (
          <>
            {/* ===== B: 顧客動態 ===== */}
            <Section title="顧客動態" icon={<Users className="h-4 w-4 text-orange-500" />} hint="在籍はHACOMONO会員 / LINEはLstep友だち">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
                <KpiCard
                  label="在籍数(月末)"
                  value={num(data.members.end_active)}
                  sub={
                    data.members.ticket_engaged != null
                      ? `月額${num(data.members.regular_active ?? 0)} / 学割${num(data.members.college_active ?? 0)} / チケ実働${num(data.members.ticket_engaged)} (休眠${num(data.members.ticket_dormant ?? 0)})`
                      : data.members.regular_active != null
                        ? `月額${num(data.members.regular_active)} / チケ${num(data.members.ticket_active ?? 0)} / 学割${num(data.members.college_active ?? 0)} (月初 ${num(data.members.start_active)})`
                        : `有効会員 (boom_members) / 月初 ${num(data.members.start_active)}人`
                  }
                  target={target.members_active}
                  current={data.members.end_active}
                  unit="人"
                  accent="orange"
                />
                <KpiCard
                  label="純増数"
                  value={`${data.members.net_growth >= 0 ? '+' : ''}${num(data.members.net_growth)}`}
                  sub={`新規 +${num(data.members.new_signups)} / 退会 -${num(data.members.churned)}`}
                  accent={data.members.net_growth >= 0 ? 'green' : 'red'}
                />
                <KpiCard
                  label="退会率(Churn)"
                  value={pct(data.members.churn_rate)}
                  sub="退会数 / 月初在籍 (業界目安 3-5%)"
                  accent={data.members.churn_rate > 5 ? 'red' : data.members.churn_rate > 3 ? 'orange' : 'green'}
                  warn={data.members.churn_rate > 5}
                />
                <KpiCard
                  label="LINE友だち数"
                  value={num(data.line.friends_now)}
                  sub="Lstep友だち (ブロック除く / 在籍数とは別)"
                  target={target.line_friends}
                  current={data.line.friends_now}
                  unit="人"
                  accent="green"
                />
                <KpiCard
                  label="LINEブロック率"
                  value={pct(data.line.block_rate)}
                  sub={`ブロック ${num(data.line.blocked)}人 / 全${num(data.line.total)}人 (業界平均20%前後)`}
                  accent={data.line.block_rate >= 30 ? 'red' : data.line.block_rate >= 25 ? 'orange' : 'green'}
                  warn={data.line.block_rate >= 30}
                />
              </div>
            </Section>

            {/* ===== E: 先行指標 ===== */}
            <Section title="先行指標" icon={<Sprout className="h-4 w-4 text-purple-500" />} hint="来月以降の入会を予兆">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                <KpiCard
                  label="体験申込数"
                  value={num(data.trial.count)}
                  sub={`うち14日以内入会 ${num(data.trial.enrolled_within_14d)}人`}
                  target={target.trial_count}
                  current={data.trial.count}
                  unit="件"
                  accent="purple"
                />
                <KpiCard
                  label="体験→入会CVR"
                  value={pct(data.trial.cvr)}
                  sub="2週間以内入会"
                  target={target.trial_cvr}
                  current={data.trial.cvr}
                  unit="%"
                  accent="purple"
                />
                <KpiCard
                  label="LINE純増"
                  value="—"
                  sub="前月比 (週次取得後に表示)"
                  accent="purple"
                />
                <KpiCard
                  label="LINE誘導クリック (7日)"
                  value={lineClicks?.ok ? num(lineClicks.ranges.find((r) => r.days === 7)?.total ?? 0) : '—'}
                  sub={lineClicks?.ok ? `うち広告経由 ${num(lineClicks.ranges.find((r) => r.days === 7)?.ads ?? 0)}件` : (lineClicks?.error ? 'GA4未設定' : '読込中...')}
                  accent="purple"
                />
                <KpiCard
                  label="LINE誘導クリック (30日)"
                  value={lineClicks?.ok ? num(lineClicks.ranges.find((r) => r.days === 30)?.total ?? 0) : '—'}
                  sub={lineClicks?.ok ? `うち広告経由 ${num(lineClicks.ranges.find((r) => r.days === 30)?.ads ?? 0)}件` : 'GA4集計は数時間遅れ'}
                  accent="purple"
                />
                <KpiCard
                  label="広告CPA概算 (30日)"
                  value={(() => { const r = lineClicks?.ranges.find((x) => x.days === 30); return r?.est_cpa_jpy != null ? `¥${num(r.est_cpa_jpy)}` : '—'; })()}
                  sub="日予算¥200×経過日数÷広告経由クリック (GA4基準・広告管理画面とは一致しない)"
                  accent="purple"
                />
              </div>
              <p className="mt-1 text-[10px] text-neutral-400">
                LINE誘導クリック: boom-sendai.com上のLINEリンク押下 (GA4 line_click・2026-06-10計測開始・数時間〜1日遅れ)
              </p>
            </Section>

            {/* ===== A: 売上系 ===== */}
            <Section title="売上" icon={<DollarSign className="h-4 w-4 text-orange-500" />} hint="スクール本業 (プラン + 単発 + 入会金)">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <KpiCard
                  label="本業売上 (税込)"
                  value={data.revenue.data_available ? yen(data.revenue.core) : '—'}
                  sub={data.revenue.data_available ? '今月計上分' : 'HACOMONO課金明細 未取込'}
                  target={target.monthly_revenue}
                  current={data.revenue.core}
                  unit="円"
                  accent="orange"
                />
                <KpiCard
                  label="プラン売上"
                  value={data.revenue.data_available ? yen(data.revenue.breakdown.plan) : '—'}
                  sub="月額会費"
                  accent="orange"
                />
                <KpiCard
                  label="単発売上"
                  value={data.revenue.data_available ? yen(data.revenue.breakdown.ticket) : '—'}
                  sub="チケット"
                  accent="orange"
                />
                <KpiCard
                  label="入会金"
                  value={data.revenue.data_available ? yen(data.revenue.breakdown.enrollment_fee) : '—'}
                  sub={data.members.new_signups > 0 ? `新規 ${data.members.new_signups}人` : ''}
                  accent="orange"
                />
              </div>
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
                <KpiCard
                  label="ARPU (客単価)"
                  value={data.revenue.data_available ? yen(data.revenue.arpu) : '—'}
                  sub="プラン売上 / 在籍数"
                  accent="blue"
                />
              </div>
              {/* 補助売上 */}
              <Card className="mt-3">
                <CardContent className="p-3">
                  <div className="text-[11px] font-semibold text-slate-600 mb-2">補助売上 (参考)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div><span className="text-slate-500 text-xs">物販: </span><span className="font-bold">{yen(data.aux_revenue.merch_orders)}</span></div>
                    <div><span className="text-slate-500 text-xs">映像予約 ({data.aux_revenue.video_preorder_count}件): </span><span className="font-bold">{yen(data.aux_revenue.video_preorders_estimate)}</span></div>
                  </div>
                </CardContent>
              </Card>
            </Section>

            {/* ===== C: オペレーション ===== */}
            <Section title={`${ymJp(ym)}の稼働率`} icon={<Crosshair className="h-4 w-4 text-orange-500" />} hint="予約数/定員 (HACOMONO RS002)">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-3">
                <KpiCard
                  label={`平均稼働率 (${ymJp(ym)})`}
                  value={data.utilization.data_available ? pct(data.utilization.average * 100) : '—'}
                  sub={data.utilization.data_available
                    ? `通常クラスのみ / ${data.utilization.lesson_count}レッスン${(data.utilization.excluded_classes?.length ?? 0) > 0 ? ` / 除外${data.utilization.excluded_classes!.length}件` : ''}`
                    : 'RS002 未取込'}
                  target={target.utilization}
                  current={data.utilization.average * 100}
                  unit="%"
                  accent={utilColor}
                />
                <KpiCard
                  label="集計レッスン数"
                  value={num(data.utilization.lesson_count)}
                  sub="通常クラスの予約データ"
                  accent="blue"
                />
              </div>
              {data.utilization.data_available && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card className="border-green-200">
                      <CardContent className="p-3">
                        <div className="text-xs font-bold text-green-700 mb-2 flex items-center gap-1">
                          <TrendingUp className="h-3.5 w-3.5" /> 稼働率TOP <span className="font-normal text-slate-400">(通常クラス)</span>
                        </div>
                        <ul className="space-y-1 text-xs">
                          {data.utilization.top_classes.map((c, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="truncate">{c.program_name} <span className="text-slate-400">/ {c.staff_name}</span></span>
                              <Badge variant="outline" className="text-green-700 font-mono">{pct(c.avg_rate * 100, 0)}</Badge>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                    <Card className="border-red-200">
                      <CardContent className="p-3">
                        <div className="text-xs font-bold text-red-700 mb-2 flex items-center gap-1">
                          <TrendingDown className="h-3.5 w-3.5" /> 稼働率BOTTOM <span className="font-normal text-slate-400">(通常クラス)</span>
                        </div>
                        <ul className="space-y-1 text-xs">
                          {data.utilization.bottom_classes.map((c, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="truncate">{c.program_name} <span className="text-slate-400">/ {c.staff_name}</span></span>
                              <Badge variant="outline" className="text-red-700 font-mono">{pct(c.avg_rate * 100, 0)}</Badge>
                            </li>
                          ))}
                        </ul>
                      </CardContent>
                    </Card>
                  </div>

                  {/* 別枠: 立ち上げ期 / 要対策 */}
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Card className="bg-orange-50 border-orange-200">
                      <CardContent className="p-3">
                        <div className="text-xs font-bold text-orange-700 mb-2 flex items-center gap-1">
                          <Sprout className="h-3.5 w-3.5" /> 立ち上げ期クラス
                          <span className="font-normal text-orange-400"> (直近{data.utilization.grace_months ?? 6}ヶ月)</span>
                        </div>
                        {(data.utilization.new_classes?.length ?? 0) === 0 ? (
                          <div className="text-[11px] text-slate-400">該当なし</div>
                        ) : (
                          <ul className="space-y-1 text-xs">
                            {data.utilization.new_classes!.map((c, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span className="truncate">
                                  {c.program_name} <span className="text-slate-400">/ {c.staff_name}</span>
                                  {c.launched_at && <span className="text-orange-400"> /{c.launched_at}~</span>}
                                </span>
                                <Badge variant="outline" className="text-orange-700 font-mono">{pct(c.avg_rate * 100, 0)}</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                    <Card className="bg-amber-50 border-amber-300">
                      <CardContent className="p-3">
                        <div className="text-xs font-bold text-amber-700 mb-2 flex items-center gap-1">
                          <TrendingDown className="h-3.5 w-3.5" /> 要対策クラス
                          <span className="font-normal text-amber-500"> (稼働率{Math.round((data.utilization.low_threshold ?? 0.2) * 100)}%未満)</span>
                        </div>
                        {(data.utilization.watch_classes?.length ?? 0) === 0 ? (
                          <div className="text-[11px] text-slate-400">該当なし</div>
                        ) : (
                          <ul className="space-y-1 text-xs">
                            {data.utilization.watch_classes!.map((c, i) => (
                              <li key={i} className="flex justify-between gap-2">
                                <span className="truncate">
                                  {c.program_name} <span className="text-slate-400">/ {c.staff_name} / {c.cnt}回</span>
                                </span>
                                <Badge variant="outline" className="text-amber-700 font-mono">{pct(c.avg_rate * 100, 0)}</Badge>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {(data.utilization.excluded_classes?.length ?? 0) > 0 && (
                    <div className="mt-2 text-[10px] text-slate-400">
                      除外: イベント等 {data.utilization.excluded_classes!.length}件
                      ({data.utilization.excluded_classes!.map(c => c.program_name).join(' / ')})
                    </div>
                  )}
                </>
              )}
            </Section>

            {/* ===== D: 収益性 ===== */}
            <Section title="収益性" icon={<Gem className="h-4 w-4 text-orange-500" />} hint="営業利益 = 本業売上 - 給与 - スタジオ料 - 経費">
              {/* 締め確定ガード(T-158): 4財源が揃っていない月は黒字赤字を確定表示しない */}
              {data.profitability.profit_confirmed === false && (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  ⚠️ この月は <b>{(data.profitability.missing_sources ?? []).join('・')}</b> のデータが未取込のため、営業利益は<b>確定値ではありません</b>（参考値）。全財源が揃うと黒字赤字を確定表示します。
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3">
                <KpiCard
                  label={data.profitability.profit_confirmed === false ? '営業利益(参考値)' : '営業利益'}
                  value={yen(data.profitability.operating_profit)}
                  sub={data.profitability.profit_confirmed === false ? 'データ不足・未確定' : `利益率 ${pct(data.profitability.profit_margin)}`}
                  accent={data.profitability.profit_confirmed === false ? 'neutral' : (data.profitability.operating_profit >= 0 ? 'green' : 'red')}
                />
                <KpiCard
                  label="給与"
                  value={yen(data.profitability.payroll)}
                  sub="payroll_runs 集計"
                  accent="red"
                />
                <KpiCard
                  label="スタジオ料"
                  value={yen(data.profitability.studio)}
                  sub="studio_billing_runs 集計"
                  accent="red"
                />
                <KpiCard
                  label="その他経費"
                  value={yen(Object.values(data.profitability.expense_breakdown).reduce((a, b) => a + b, 0))}
                  sub="広告/システム/通信/備品/他"
                  accent="red"
                />
              </div>
              <Card>
                <CardContent className="p-3">
                  <div className="text-xs font-bold text-neutral-600 mb-2">経費内訳</div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                    {Object.entries(data.profitability.expense_breakdown).map(([k, v]) => (
                      <div key={k} className="border-l-2 border-orange-200 pl-2">
                        <div className="text-neutral-500 text-[10px]">{k}</div>
                        <div className="font-bold">{yen(v)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </Section>

            {trends && trends.months.length > 0 && (
              <Section title="トレンド (過去6ヶ月)" icon={<BarChart3 className="h-4 w-4 text-orange-500" />} hint="月次推移">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <TrendChart
                    title="本業売上 (円)"
                    values={trends.revenue}
                    months={trends.months}
                    suffix="円"
                    isPct={false}
                  />
                  <TrendChart
                    title="在籍数 (人)"
                    values={trends.members_active}
                    months={trends.months}
                    suffix="人"
                    isPct={false}
                  />
                  <TrendChart
                    title="LINE友だち (人)"
                    values={trends.line_friends}
                    months={trends.months}
                    suffix="人"
                    isPct={false}
                  />
                  <TrendChart
                    title="退会率 (%)"
                    values={trends.churn_rate}
                    months={trends.months}
                    suffix="%"
                    isPct={true}
                    lowerIsBetter
                  />
                  <TrendChart
                    title="平均稼働率 (%)"
                    values={trends.utilization ?? []}
                    months={trends.months}
                    suffix="%"
                    isPct={true}
                  />
                </div>
              </Section>
            )}

            <p className="text-[10px] text-slate-400 text-right mt-4">
              生成: {new Date(data.generated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </p>
          </>
        )}
      </div>

      <Dialog open={showTargets} onOpenChange={setShowTargets}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <Target className="h-4 w-4" /> {ym} の目標値
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {Object.entries(TARGET_LABELS).map(([k, info]) => (
              <div key={k}>
                <Label className="text-xs font-semibold text-slate-600">{info.label}</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={targetForm[k] ?? ''}
                    onChange={e => setTargetForm({ ...targetForm, [k]: e.target.value })}
                    placeholder={info.placeholder}
                  />
                  <span className="text-xs text-slate-500">{info.unit}</span>
                </div>
              </div>
            ))}
            <Button onClick={saveTargets} className="w-full bg-orange-500 hover:bg-orange-600">
              保存
            </Button>
            <p className="text-[10px] text-slate-400">空欄にすると目標値が削除されない点に注意。値を0にして無効化してください</p>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
