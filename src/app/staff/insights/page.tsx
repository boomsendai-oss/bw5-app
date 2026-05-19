'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

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

export default function InsightsPage() {
  const [ym, setYm] = useState(currentYM());
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

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
          <div className="flex items-center gap-1">
            <button onClick={() => setYm(shiftYM(ym, -1))} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold">◀</button>
            <span className="text-sm font-bold text-orange-700 px-2">{ym}</span>
            <button onClick={() => setYm(shiftYM(ym, 1))} className="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 text-xs font-semibold">▶</button>
            <button onClick={() => setYm(currentYM())} className="ml-1 px-2 py-1 rounded text-xs bg-slate-100 hover:bg-slate-200 border border-slate-300">今月</button>
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

            <p className="text-[10px] text-slate-400 text-right mt-4">
              生成: {new Date(data.generated_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
