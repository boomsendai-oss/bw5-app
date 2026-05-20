'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

type TrendData = {
  months: string[];
  revenue: number[];
  members_active: number[];
  line_friends: number[];
  churn_rate: number[];
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
    <div className="bg-white border border-orange-200 rounded-xl p-3">
      <div className="flex items-baseline justify-between mb-1">
        <div className="text-[11px] text-neutral-500 font-medium">{title}</div>
        <div className="text-[10px] font-mono text-neutral-400">{delta}</div>
      </div>
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-lg font-bold text-orange-700">{latest}</span>
        <span className={`text-[10px] font-semibold ${good ? 'text-green-600' : 'text-red-600'}`}>
          {delta !== '—' ? (positive ? '↑' : '↓') : ''}
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
    </div>
  );
}

type DashboardData = {
  year_month: string;
  prev_year_month: string;
  period: { start: string; end: string };
  members: {
    start_active: number; end_active: number; new_signups: number;
    churned: number; net_growth: number; churn_rate: number;
  };
  trial: { count: number; enrolled_within_14d: number; cvr: number };
  line: { friends_now: number };
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
  };
  profitability: {
    revenue: number; payroll: number; studio: number;
    expense_breakdown: Record<string, number>;
    total_expenses: number; operating_profit: number; profit_margin: number;
  };
  targets: Record<string, number>;
  generated_at: string;
};

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('ja-JP')}`;
}
function num(n: number): string { return n.toLocaleString('ja-JP'); }
function pct(n: number, decimals = 1): string { return `${n.toFixed(decimals)}%`; }

function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
  accent?: 'orange' | 'blue' | 'green' | 'red' | 'purple';
  warn?: boolean;
};

function KpiCard({ label, value, sub, target, current, unit, accent = 'orange', warn }: KpiCardProps) {
  const palette: Record<string, string> = {
    orange: 'text-orange-700 border-orange-200',
    blue: 'text-blue-700 border-blue-200',
    green: 'text-green-700 border-green-200',
    red: 'text-red-700 border-red-200',
    purple: 'text-purple-700 border-purple-200',
  };
  const progress = target && current !== undefined ? Math.min(100, (current / target) * 100) : null;
  return (
    <div className={`bg-white border ${warn ? 'border-red-300' : palette[accent].split(' ')[1]} rounded-xl p-3`}>
      <div className="text-[11px] text-neutral-500 font-medium">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${warn ? 'text-red-700' : palette[accent].split(' ')[0]}`}>{value}</div>
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
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base sm:text-lg font-bold text-neutral-800">{title}</h2>
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
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader
        title="📊 経営インサイト"
        description="月次KPI自動集計ダッシュボード"
        rightExtra={
          <div className="flex items-center gap-1 flex-wrap">
            <label className={`px-2 py-1 rounded text-xs cursor-pointer border ${uploading ? 'bg-slate-200 text-slate-400' : 'bg-blue-50 hover:bg-blue-100 border-blue-200 text-blue-700'}`} title="HACOMONO RS002「固定枠：レッスン別予約集計」CSV">
              {uploading ? '取込中...' : '📥 稼働率CSV'}
              <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadCsv('/api/staff/kpi/import-rs002', '稼働率', f);
                e.target.value = '';
              }} />
            </label>
            <label className={`px-2 py-1 rounded text-xs cursor-pointer border ${uploading ? 'bg-slate-200 text-slate-400' : 'bg-green-50 hover:bg-green-100 border-green-200 text-green-700'}`} title="HACOMONO 課金明細 CSV (プラン/単発/入会金)">
              📥 課金明細
              <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadCsv('/api/staff/kpi/import-hacomono-billing', 'HACOMONO課金明細', f);
                e.target.value = '';
              }} />
            </label>
            <label className={`px-2 py-1 rounded text-xs cursor-pointer border ${uploading ? 'bg-slate-200 text-slate-400' : 'bg-purple-50 hover:bg-purple-100 border-purple-200 text-purple-700'}`} title="GMO青空ネット銀行 取引CSV">
              📥 銀行CSV
              <input type="file" accept=".csv" className="hidden" disabled={uploading} onChange={e => {
                const f = e.target.files?.[0];
                if (f) uploadCsv('/api/staff/kpi/import-bank', '銀行明細', f);
                e.target.value = '';
              }} />
            </label>
            <button onClick={() => setYm(shiftYM(ym, -1))} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold">◀</button>
            <span className="text-sm font-bold text-orange-700 px-2">{ym}</span>
            <button onClick={() => setYm(shiftYM(ym, 1))} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold">▶</button>
            <button onClick={() => setYm(currentYM())} className="ml-1 px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300">今月</button>
            <button onClick={openTargets} className="ml-1 px-2 py-1 rounded text-xs bg-amber-50 hover:bg-amber-100 border border-amber-300 text-amber-700">🎯 目標</button>
          </div>
        }
      />

      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">読込エラー: {err}</div>}
        {loading && <p className="text-slate-500 text-sm py-4">読込中...</p>}

        {data && (
          <>
            {/* ===== B: 顧客動態 ===== */}
            <Section title="👥 顧客動態" hint="プラン会員ベース">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                <KpiCard
                  label="在籍数(月末)"
                  value={num(data.members.end_active)}
                  sub={`月初 ${num(data.members.start_active)} → 月末`}
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
                  sub="月初在籍 ÷ 退会数 (業界目安 3-5%)"
                  accent={data.members.churn_rate > 5 ? 'red' : data.members.churn_rate > 3 ? 'orange' : 'green'}
                  warn={data.members.churn_rate > 5}
                />
                <KpiCard
                  label="LINE友だち"
                  value={num(data.line.friends_now)}
                  sub="現在値 (ブロック除く)"
                  target={target.line_friends}
                  current={data.line.friends_now}
                  unit="人"
                  accent="green"
                />
              </div>
            </Section>

            {/* ===== E: 先行指標 ===== */}
            <Section title="🌱 先行指標" hint="来月以降の入会を予兆">
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
              </div>
            </Section>

            {/* ===== A: 売上系 ===== */}
            <Section title="💰 売上" hint="スクール本業 (プラン + 単発 + 入会金)">
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
                  sub="プラン売上 ÷ 在籍数"
                  accent="blue"
                />
              </div>
              {/* 補助売上 */}
              <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <div className="text-[11px] font-semibold text-slate-600 mb-2">補助売上 (参考)</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div><span className="text-slate-500 text-xs">物販: </span><span className="font-bold">{yen(data.aux_revenue.merch_orders)}</span></div>
                  <div><span className="text-slate-500 text-xs">映像予約 ({data.aux_revenue.video_preorder_count}件): </span><span className="font-bold">{yen(data.aux_revenue.video_preorders_estimate)}</span></div>
                </div>
              </div>
            </Section>

            {/* ===== C: オペレーション ===== */}
            <Section title="🎯 オペレーション" hint="クラス稼働率 (HACOMONO RS002)">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-3">
                <KpiCard
                  label="平均稼働率"
                  value={data.utilization.data_available ? pct(data.utilization.average * 100) : '—'}
                  sub={data.utilization.data_available ? `${data.utilization.lesson_count}レッスン` : 'RS002 未取込'}
                  target={target.utilization}
                  current={data.utilization.average * 100}
                  unit="%"
                  accent={utilColor}
                />
                <KpiCard
                  label="集計レッスン数"
                  value={num(data.utilization.lesson_count)}
                  sub="HACOMONO予約データ"
                  accent="blue"
                />
              </div>
              {data.utilization.data_available && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-white border border-green-200 rounded-lg p-3">
                    <div className="text-xs font-bold text-green-700 mb-2">🔥 稼働率TOP</div>
                    <ul className="space-y-1 text-xs">
                      {data.utilization.top_classes.map((c, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">{c.program_name} <span className="text-slate-400">/ {c.staff_name}</span></span>
                          <span className="font-mono font-bold text-green-700">{pct(c.avg_rate * 100, 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-white border border-red-200 rounded-lg p-3">
                    <div className="text-xs font-bold text-red-700 mb-2">⚠️ 稼働率BOTTOM</div>
                    <ul className="space-y-1 text-xs">
                      {data.utilization.bottom_classes.map((c, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span className="truncate">{c.program_name} <span className="text-slate-400">/ {c.staff_name}</span></span>
                          <span className="font-mono font-bold text-red-700">{pct(c.avg_rate * 100, 0)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </Section>

            {/* ===== D: 収益性 ===== */}
            <Section title="💎 収益性" hint="営業利益 = 本業売上 − 給与 − スタジオ料 − 経費">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-3">
                <KpiCard
                  label="営業利益"
                  value={yen(data.profitability.operating_profit)}
                  sub={`利益率 ${pct(data.profitability.profit_margin)}`}
                  accent={data.profitability.operating_profit >= 0 ? 'green' : 'red'}
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
              <div className="bg-white border border-neutral-200 rounded-lg p-3">
                <div className="text-xs font-bold text-neutral-600 mb-2">経費内訳</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                  {Object.entries(data.profitability.expense_breakdown).map(([k, v]) => (
                    <div key={k} className="border-l-2 border-orange-200 pl-2">
                      <div className="text-neutral-500 text-[10px]">{k}</div>
                      <div className="font-bold">{yen(v)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            {trends && trends.months.length > 0 && (
              <Section title="📈 トレンド (過去6ヶ月)" hint="月次推移">
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
                </div>
              </Section>
            )}

            <p className="text-[10px] text-slate-400 text-right mt-4">
              生成: {new Date(data.generated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </p>
          </>
        )}
      </div>

      {showTargets && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3" onClick={() => setShowTargets(false)}>
          <div className="bg-white w-full max-w-md rounded-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold">🎯 {ym} の目標値</h3>
              <button onClick={() => setShowTargets(false)} className="text-2xl text-slate-400 leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3">
              {Object.entries(TARGET_LABELS).map(([k, info]) => (
                <div key={k}>
                  <label className="text-xs font-semibold text-slate-600">{info.label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={targetForm[k] ?? ''}
                      onChange={e => setTargetForm({ ...targetForm, [k]: e.target.value })}
                      placeholder={info.placeholder}
                      className="flex-1 px-3 py-2 border rounded text-sm"
                    />
                    <span className="text-xs text-slate-500">{info.unit}</span>
                  </div>
                </div>
              ))}
              <button onClick={saveTargets} className="w-full py-2 bg-orange-500 hover:bg-orange-600 text-white rounded font-semibold">
                保存
              </button>
              <p className="text-[10px] text-slate-400">空欄にすると目標値が削除されない点に注意。値を0にして無効化してください</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
