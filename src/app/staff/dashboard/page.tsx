'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { BarChart3, FileText, Plus, RefreshCw, Pencil, Trash2, Copy } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

type Snapshot = {
  id: number;
  snapshot_date: string; // YYYY-MM-01
  line_friends: number;
  hacomono_members_active: number;
  hacomono_members_retired: number;
  monthly_revenue: number;
  monthly_expense: number;
  monthly_profit: number;
  trial_count: number;
  new_signup_count: number;
  retention_count: number;
  churn_count: number;
  notes: string;
  created_at: string;
  updated_at: string;
};

const ORANGE = '#dc4c04';
const BLUE = '#0ea5e9';
const GREEN = '#16a34a';
const PURPLE = '#9333ea';

// CVR(体験→入会)の唯一の定義:
// 「当月体験者のうち14日以内に入会した実数(retention_count) / 体験数(trial_count)」。
// カードもグラフもこの関数を使い、二重定義を排除する。
// new_signup_count(当月入会総数)は体験者本人かに関わらず数えるため CVR には使わない。
function computeCvr(s: { trial_count: number; retention_count: number } | undefined | null): number | null {
  if (!s || !s.trial_count) return null;
  return (s.retention_count / s.trial_count) * 100;
}

function formatYM(date: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${m[1]}/${m[2]}`;
}

function formatNumber(n: number): string {
  return n.toLocaleString('ja-JP');
}

function formatYen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

type CardProps = {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
};

function SummaryCard({ label, value, sub, accent = ORANGE }: CardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-neutral-500">{label}</div>
        <div className="mt-1 text-2xl font-bold" style={{ color: accent }}>
          {value}
        </div>
        {sub && <div className="mt-1 text-xs text-neutral-500">{sub}</div>}
      </CardContent>
    </Card>
  );
}

type AutoSnapshotDetail = {
  year_month: string;
  members: {
    total_active: number;
    ticket: number;
    monthly: number;
    rest: number;
    other: number;
    withdrew_total: number;
  };
  lstep: {
    total: number;
    blocked: number;
    phase_4a_member: number;
    phase_4b_parent: number;
    phase_trial_reserved: number;
    phase_trial_done: number;
    phase_line_only: number;
  };
  links: {
    linked_members: number;
    by_relation: { honnin: number; hogosha: number; koushi: number };
    unlinked_members: number;
  };
  trial: {
    month_reserved: number;
    month_attended: number;
    month_canceled: number;
    month_converted: number;
    cvr_pct: number | null;
  };
};

function parseAutoDetail(notes: string | null | undefined): AutoSnapshotDetail | null {
  if (!notes) return null;
  try {
    const j = JSON.parse(notes);
    if (j?.auto && j?.detail) return j.detail as AutoSnapshotDetail;
  } catch {
    /* not JSON */
  }
  return null;
}

export default function DashboardPage() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [autoMessage, setAutoMessage] = useState<string>('');
  const [reportMarkdown, setReportMarkdown] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/kpi/snapshots', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/dashboard';
        return;
      }
      const data = await res.json();
      setSnapshots(data.snapshots ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function runAutoSnapshot() {
    setAutoBusy(true);
    setAutoMessage('');
    try {
      const res = await fetch('/api/staff/operations/snapshot-kpi', {
        method: 'POST',
        credentials: 'include',
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/dashboard';
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setAutoMessage(`失敗: ${data?.error ?? res.statusText}`);
      } else {
        setAutoMessage(`${data.snapshot_date} の KPI を自動集計しました`);
        await load();
      }
    } catch (e) {
      setAutoMessage(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAutoBusy(false);
    }
  }

  async function generateMonthlyReport() {
    setReportBusy(true);
    setReportMarkdown('');
    try {
      const res = await fetch('/api/staff/operations/monthly-report', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/dashboard';
        return;
      }
      const data = await res.json();
      if (!res.ok) {
        setAutoMessage(`レポート生成失敗: ${data?.error ?? res.statusText}`);
      } else {
        setReportMarkdown(data.report_markdown ?? '');
        setAutoMessage(`${data.year_month} の月次レポートを生成しました`);
      }
    } catch (e) {
      setAutoMessage(`失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReportBusy(false);
    }
  }

  async function remove(id: number) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/staff/kpi/snapshots/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (res.ok) {
        load();
      }
    } finally {
      setDeletingId(null);
    }
  }

  // 最新月
  const latest = snapshots[0];
  const prev = snapshots[1];

  // CVR (体験→入会) -- カード・グラフ共通の computeCvr を使う(14日以内入会の実数 / 体験数)
  const cvr = useMemo(() => computeCvr(latest), [latest]);
  const prevCvr = useMemo(() => computeCvr(prev), [prev]);

  // 過去6ヶ月推移: 体験/入会/退会/CVR
  const chartFlowData = useMemo(() => {
    return snapshots
      .slice(0, 6)
      .slice()
      .reverse()
      .map((s) => {
        const cvr = computeCvr(s) ?? 0;
        return {
          month: formatYM(s.snapshot_date),
          体験: s.trial_count,
          新規入会: s.new_signup_count,
          退会: s.churn_count,
          'CVR(%)': Math.round(cvr * 10) / 10,
        };
      });
  }, [snapshots]);

  // 過去6ヶ月推移 (古い→新しい順)
  const chartData = useMemo(() => {
    return snapshots
      .slice(0, 6)
      .slice()
      .reverse()
      .map((s) => ({
        month: formatYM(s.snapshot_date),
        LINE友達: s.line_friends,
        会員数: s.hacomono_members_active,
        売上: s.monthly_revenue,
        利益: s.monthly_profit,
      }));
  }, [snapshots]);

  function deltaLabel(curr: number, p: number | undefined): string {
    if (p === undefined || p === null || p === 0) return '前月比 -';
    const diff = curr - p;
    const pctVal = (diff / p) * 100;
    const sign = diff >= 0 ? '↑' : '↓';
    return `前月比 ${sign}${Math.abs(pctVal).toFixed(1)}%`;
  }

  return (
    <main className="text-neutral-900">
      <div className="border-b bg-white px-4 py-3">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h1 className="text-lg font-bold text-neutral-800 flex items-center gap-1.5">
              <BarChart3 className="h-5 w-5 text-orange-500" />
              KPIダッシュボード
            </h1>
            <p className="text-xs text-neutral-500">Phase 1 MVP (手動入力)</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              onClick={runAutoSnapshot}
              disabled={autoBusy}
              size="sm"
              className="bg-blue-500 hover:bg-blue-600"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${autoBusy ? 'animate-spin' : ''}`} />
              {autoBusy ? '集計中...' : '最新KPI自動集計'}
            </Button>
            <Button
              onClick={generateMonthlyReport}
              disabled={reportBusy}
              size="sm"
              className="bg-purple-500 hover:bg-purple-600"
            >
              <FileText className={`h-3.5 w-3.5 mr-1`} />
              {reportBusy ? '生成中...' : '月次レポート生成'}
            </Button>
            <Button size="sm" className="bg-orange-500 hover:bg-orange-600" asChild>
              <Link href="/staff/dashboard/input">
                <Plus className="h-3.5 w-3.5 mr-1" />
                月次データを追加
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {autoMessage && (
        <div className="bg-blue-50 border-b border-blue-200 px-6 py-2 text-sm text-blue-800">
          {autoMessage}
        </div>
      )}

      <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        {loading ? (
          <div className="text-neutral-500">読み込み中...</div>
        ) : !latest ? (
          <Card className="text-center">
            <CardContent className="p-8 text-neutral-500">
              まだ月次データがありません。「+ 月次データを追加」から入力してください。
            </CardContent>
          </Card>
        ) : (
          <>
            {/* サマリーカード */}
            <section>
              <div className="text-xs text-neutral-500 mb-2">
                {formatYM(latest.snapshot_date)} の数値
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <SummaryCard
                  label="LINE友達数"
                  value={formatNumber(latest.line_friends)}
                  sub={deltaLabel(latest.line_friends, prev?.line_friends)}
                  accent={ORANGE}
                />
                <SummaryCard
                  label="在籍会員数"
                  value={formatNumber(latest.hacomono_members_active)}
                  sub={deltaLabel(latest.hacomono_members_active, prev?.hacomono_members_active)}
                  accent={BLUE}
                />
                <SummaryCard
                  label="月間売上"
                  value={formatYen(latest.monthly_revenue)}
                  sub={deltaLabel(latest.monthly_revenue, prev?.monthly_revenue)}
                  accent={GREEN}
                />
                <SummaryCard
                  label="体験→入会CVR"
                  value={cvr === null ? '-' : `${cvr.toFixed(1)}%`}
                  sub={
                    prevCvr === null
                      ? '前月比 -'
                      : `前月 ${prevCvr.toFixed(1)}%`
                  }
                  accent={PURPLE}
                />
              </div>
            </section>

            {/* 推移グラフ */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">過去6ヶ月 推移 -- 会員系</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="LINE友達"
                        stroke={ORANGE}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="会員数"
                        stroke={BLUE}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">過去6ヶ月 推移 -- 金額系</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `¥${(v / 1000).toFixed(0)}k`} />
                      <Tooltip formatter={(v) => formatYen(Number(v) || 0)} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line
                        type="monotone"
                        dataKey="売上"
                        stroke={GREEN}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="利益"
                        stroke={PURPLE}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* 自動集計内訳 (最新月) */}
            {(() => {
              const d = parseAutoDetail(latest.notes);
              if (!d) return null;
              return (
                <Card className="border-blue-100">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <BarChart3 className="h-4 w-4 text-blue-500" />
                      自動集計内訳 -- {d.year_month}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <SummaryCard label="チケット会員" value={formatNumber(d.members.ticket)} accent={ORANGE} />
                      <SummaryCard label="マンスリー会員" value={formatNumber(d.members.monthly)} accent={BLUE} />
                      <SummaryCard label="休会" value={formatNumber(d.members.rest)} accent={'#a3a3a3'} />
                      <SummaryCard label="その他" value={formatNumber(d.members.other)} accent={'#737373'} />
                      <SummaryCard label="LINE 4-A 本人" value={formatNumber(d.lstep.phase_4a_member)} accent={GREEN} />
                      <SummaryCard label="LINE 4-B 保護者" value={formatNumber(d.lstep.phase_4b_parent)} accent={PURPLE} />
                      <SummaryCard label="体験予約済" value={formatNumber(d.lstep.phase_trial_reserved)} accent={ORANGE} />
                      <SummaryCard label="体験受講済" value={formatNumber(d.lstep.phase_trial_done)} accent={BLUE} />
                      <SummaryCard label="LINE登録のみ" value={formatNumber(d.lstep.phase_line_only)} accent={'#a3a3a3'} />
                      <SummaryCard label="ブロック" value={formatNumber(d.lstep.blocked)} accent={'#dc2626'} />
                      <SummaryCard label="紐付け済会員" value={formatNumber(d.links.linked_members)} accent={GREEN} />
                      <SummaryCard label="未紐付け会員" value={formatNumber(d.links.unlinked_members)} accent={'#dc2626'} />
                      <SummaryCard label="体験予約 (当月)" value={formatNumber(d.trial.month_reserved)} accent={BLUE} />
                      <SummaryCard label="体験受講 (当月)" value={formatNumber(d.trial.month_attended)} accent={GREEN} />
                      <SummaryCard label="体験キャンセル" value={formatNumber(d.trial.month_canceled)} accent={'#dc2626'} />
                      <SummaryCard label="体験→入会CVR" value={d.trial.cvr_pct === null ? '-' : `${d.trial.cvr_pct.toFixed(1)}%`} accent={PURPLE} />
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* 月次推移グラフ -- 体験/入会/退会 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">過去6ヶ月 推移 -- 体験 / 新規入会 / 退会</CardTitle>
              </CardHeader>
              <CardContent>
                <div style={{ width: '100%', height: 280 }}>
                  <ResponsiveContainer>
                    <LineChart data={chartFlowData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line type="monotone" dataKey="体験" stroke={BLUE} strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="新規入会" stroke={GREEN} strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="退会" stroke={'#dc2626'} strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="CVR(%)" stroke={PURPLE} strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            {/* 月次レポート Markdown */}
            {reportMarkdown && (
              <Card className="border-purple-100">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <FileText className="h-4 w-4 text-purple-500" />
                      月次レポート (Markdown)
                    </CardTitle>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigator.clipboard?.writeText(reportMarkdown)}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      コピー
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs whitespace-pre-wrap bg-neutral-50 rounded p-3 max-h-96 overflow-auto">
                    {reportMarkdown}
                  </pre>
                </CardContent>
              </Card>
            )}

            {/* 月次データ一覧 */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">月次データ一覧</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">月</TableHead>
                        <TableHead className="text-xs text-right">LINE</TableHead>
                        <TableHead className="text-xs text-right">会員</TableHead>
                        <TableHead className="text-xs text-right">体験</TableHead>
                        <TableHead className="text-xs text-right">入会</TableHead>
                        <TableHead className="text-xs text-right">退会</TableHead>
                        <TableHead className="text-xs text-right">売上</TableHead>
                        <TableHead className="text-xs text-right">利益</TableHead>
                        <TableHead className="text-xs"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {snapshots.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell className="text-xs font-mono">{formatYM(s.snapshot_date)}</TableCell>
                          <TableCell className="text-xs text-right">{formatNumber(s.line_friends)}</TableCell>
                          <TableCell className="text-xs text-right">{formatNumber(s.hacomono_members_active)}</TableCell>
                          <TableCell className="text-xs text-right">{formatNumber(s.trial_count)}</TableCell>
                          <TableCell className="text-xs text-right">{formatNumber(s.new_signup_count)}</TableCell>
                          <TableCell className="text-xs text-right">{formatNumber(s.churn_count)}</TableCell>
                          <TableCell className="text-xs text-right">{formatYen(s.monthly_revenue)}</TableCell>
                          <TableCell className="text-xs text-right">{formatYen(s.monthly_profit)}</TableCell>
                          <TableCell className="text-xs text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="sm" className="h-7 px-2 text-orange-600" asChild>
                                <Link href={`/staff/dashboard/input?id=${s.id}`}>
                                  <Pencil className="h-3 w-3" />
                                </Link>
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 px-2 text-red-500"
                                    disabled={deletingId === s.id}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>月次データの削除</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      この月次データを削除しますか? この操作は元に戻せません。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => remove(s.id)}
                                      className="bg-red-500 hover:bg-red-600"
                                    >
                                      削除
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
