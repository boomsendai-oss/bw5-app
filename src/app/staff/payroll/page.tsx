'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { RefreshCw, Landmark, Upload, CheckCircle, Eye, Trash2, FolderOpen, Printer, Loader2, CalendarDays, ArrowUpFromLine } from 'lucide-react';
import { yen } from '@/lib/utils';

type PayrollRun = {
  id: number;
  year_month: string;
  instructor_id: number;
  instructor_name: string;
  salary_type: string;
  total_lesson_amount: number;
  total_transit_amount: number;
  total_adjustment_amount: number;
  total_amount: number;
  payment_date: string | null;
  status: string;
  pdf_url: string | null;
  payslip_folder_url: string | null;
  generated_at: string | null;
  drive_file_id: string | null;
  payslip_uploaded_at: string | null;
};

type Line = {
  id: number;
  lesson_date: string;
  class_name: string | null;
  duration_minutes: number | null;
  studio_name: string | null;
  lesson_rate: number;
  transit_fee: number;
  source: string;
};

type Adjustment = {
  id: number;
  adjustment_type: string;
  amount: number;
  description: string;
  created_at: string;
};

type RunDetail = {
  run: PayrollRun;
  lines: Line[];
  adjustments: Adjustment[];
};

const ADJ_TYPES = [
  { value: 'event_bonus', label: 'イベント手当' },
  { value: 'substitute_fee', label: '代講料' },
  { value: 'special_lesson', label: '特別レッスン単価' },
  { value: 'deduction', label: '減算' },
  { value: 'other', label: 'その他' },
];

function prevYM(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function statusBadge(status: string, uploaded?: boolean) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={status === 'paid' ? 'default' : status === 'confirmed' ? 'secondary' : 'outline'}>
        {status === 'paid' ? '振込済' : status === 'confirmed' ? '確定' : '下書き'}
      </Badge>
      {uploaded && <Badge variant="default" className="bg-emerald-600">配布済</Badge>}
    </span>
  );
}

export default function PayrollPage() {
  const [ym, setYm] = useState(prevYM());
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [adjForm, setAdjForm] = useState<{ type: string; amount: string; description: string }>({ type: 'event_bonus', amount: '', description: '' });

  // AlertDialog state
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} });

  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, title, description, onConfirm });
  };

  // プレビューURL: アップ済みならDriveの埋め込みプレビュー(高速・キャッシュ済)、未アップはサーバー生成
  const previewUrl = (r: PayrollRun): string => {
    if (r.drive_file_id) {
      return `https://drive.google.com/file/d/${r.drive_file_id}/view`;
    }
    return `/api/staff/payroll/${r.id}/pdf`;
  };

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/staff/payroll?year_month=${target}`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/staff/events/login?next=/staff/payroll'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRuns(d.runs ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(ym); }, [ym, load]);

  const calculate = async () => {
    showConfirm(
      '給与計算',
      `${ym} の給与を計算します。draft状態のデータは上書きされます。よろしいですか?`,
      async () => {
        setBusy(true);
        setErr('');
        try {
          const res = await fetch(`/api/staff/payroll/calculate`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year_month: ym }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
          load(ym);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          load(ym);
        } finally {
          setBusy(false);
        }
      }
    );
  };

  const [rowBusy, setRowBusy] = useState<Record<number, string>>({});

  const uploadOne = async (runId: number): Promise<boolean> => {
    setRowBusy(s => ({ ...s, [runId]: "up" }));
    try {
      const res = await fetch(`/api/staff/payroll/${runId}/payslip/upload`, { method: "POST", credentials: "include" });
      if (!res.ok) { throw new Error(await res.text()); }
      return true;
    } catch (e) {
      setErr(`アップロード失敗(run ${runId}): ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
    }
  };

  const deleteOne = async (runId: number) => {
    showConfirm(
      'Drive明細削除',
      'Driveの明細PDFを削除しますか?',
      async () => {
        setRowBusy(s => ({ ...s, [runId]: "del" }));
        const prev = runs;
        setRuns(rs => rs.map(r => r.id === runId ? { ...r, drive_file_id: null, payslip_uploaded_at: null } : r));
        try {
          const res = await fetch(`/api/staff/payroll/${runId}/payslip`, { method: "DELETE", credentials: "include" });
          if (!res.ok) throw new Error(await res.text());
          load(ym);
        } catch (e) {
          setRuns(prev);
          setErr(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
          load(ym);
        } finally {
          setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
        }
      }
    );
  };

  const uploadAll = async () => {
    showConfirm(
      '一括アップロード',
      `${runs.length}名分の明細をDriveへアップロードします。よろしいですか?`,
      async () => {
        setBusy(true);
        let ok = 0, ng = 0;
        for (const r of runs) {
          const success = await uploadOne(r.id);
          success ? ok++ : ng++;
        }
        setBusy(false);
        await load(ym);
        alert(`アップロード完了: 成功 ${ok} / 失敗 ${ng}`);
      }
    );
  };

  const confirmAll = async () => {
    const drafts = runs.filter(r => r.status === 'draft');
    if (drafts.length === 0) { alert('確定対象(下書き)がありません'); return; }
    showConfirm(
      '全員確定',
      `下書きの${drafts.length}名を「確定」にします。よろしいですか?`,
      async () => {
        setBusy(true);
        setErr('');
        const draftIds = new Set(drafts.map(d => d.id));
        const prev = runs;
        setRuns(rs => rs.map(r => draftIds.has(r.id) ? { ...r, status: 'confirmed' } : r));
        const failed: number[] = [];
        for (const r of drafts) {
          try {
            const res = await fetch(`/api/staff/payroll/${r.id}`, {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'confirmed' }),
            });
            if (!res.ok) throw new Error(await res.text());
          } catch {
            failed.push(r.id);
          }
        }
        if (failed.length > 0) {
          const failedSet = new Set(failed);
          setRuns(rs => rs.map(r => {
            if (!failedSet.has(r.id)) return r;
            const orig = prev.find(p => p.id === r.id);
            return orig ? { ...r, status: orig.status } : r;
          }));
          setErr(`確定失敗: ${failed.length}名(他${drafts.length - failed.length}名は確定済)`);
        }
        setBusy(false);
        alert(`${drafts.length - failed.length}名を確定しました${failed.length ? ` / 失敗 ${failed.length}名` : ''}`);
      }
    );
  };

  const openDetail = async (runId: number) => {
    const res = await fetch(`/api/staff/payroll/${runId}`, { credentials: 'include' });
    if (!res.ok) return;
    const d = await res.json();
    setDetail(d);
  };

  const addAdjustment = async () => {
    if (!detail) return;
    const amount = parseInt(adjForm.amount, 10);
    if (isNaN(amount) || !adjForm.description.trim()) {
      alert('金額(数値)と説明を入力してください');
      return;
    }
    const snapForm = { ...adjForm };
    const snapDetail = detail;
    const runId = detail.run.id;
    const tempId = -Date.now();
    const optimisticAdj: Adjustment = {
      id: tempId,
      adjustment_type: snapForm.type,
      amount,
      description: snapForm.description.trim(),
      created_at: new Date().toISOString(),
    };
    setDetail({
      ...snapDetail,
      adjustments: [...snapDetail.adjustments, optimisticAdj],
      run: {
        ...snapDetail.run,
        total_adjustment_amount: snapDetail.run.total_adjustment_amount + amount,
        total_amount: snapDetail.run.total_amount + amount,
      },
    });
    setRuns(rs => rs.map(r => r.id === runId
      ? { ...r, total_adjustment_amount: r.total_adjustment_amount + amount, total_amount: r.total_amount + amount }
      : r));
    setAdjForm({ type: 'event_bonus', amount: '', description: '' });
    try {
      const res = await fetch(`/api/staff/payroll/${runId}/adjustments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustment_type: snapForm.type,
          amount,
          description: snapForm.description.trim(),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      openDetail(runId);
      load(ym);
    } catch (e) {
      setErr(`調整追加失敗: ${e instanceof Error ? e.message : String(e)}`);
      openDetail(runId);
      load(ym);
    }
  };

  const deleteAdjustment = async (adjId: number) => {
    if (!detail) return;
    showConfirm(
      '調整項目削除',
      'この調整項目を削除しますか?',
      async () => {
        const snapDetail = detail;
        const runId = detail.run.id;
        const target = snapDetail.adjustments.find(a => a.id === adjId);
        if (!target) return;
        setDetail({
          ...snapDetail,
          adjustments: snapDetail.adjustments.filter(a => a.id !== adjId),
          run: {
            ...snapDetail.run,
            total_adjustment_amount: snapDetail.run.total_adjustment_amount - target.amount,
            total_amount: snapDetail.run.total_amount - target.amount,
          },
        });
        setRuns(rs => rs.map(r => r.id === runId
          ? { ...r, total_adjustment_amount: r.total_adjustment_amount - target.amount, total_amount: r.total_amount - target.amount }
          : r));
        try {
          const res = await fetch(`/api/staff/payroll/${runId}/adjustments?adj_id=${adjId}`, { method: 'DELETE', credentials: 'include' });
          if (!res.ok) throw new Error(await res.text());
          openDetail(runId);
          load(ym);
        } catch (e) {
          setErr(`調整削除失敗: ${e instanceof Error ? e.message : String(e)}`);
          openDetail(runId);
          load(ym);
        }
      }
    );
  };

  const updateStatus = async (runId: number, status: string) => {
    setRuns(rs => rs.map(r => r.id === runId ? { ...r, status } : r));
    if (detail?.run.id === runId) {
      setDetail(d => d ? { ...d, run: { ...d.run, status } } : d);
    }
    try {
      const res = await fetch(`/api/staff/payroll/${runId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(await res.text());
      load(ym);
    } catch (e) {
      setErr(`状態変更失敗: ${e instanceof Error ? e.message : String(e)}`);
      load(ym);
    }
  };

  const changeStatus = async (runId: number, next: string) => {
    const prev = runs;
    setRowBusy(s => ({ ...s, [runId]: 'status' }));
    setRuns(rs => rs.map(r => r.id === runId ? { ...r, status: next } : r));
    try {
      const res = await fetch(`/api/staff/payroll/${runId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      setRuns(prev);
      setErr(`状態変更失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
    }
  };

  const grandTotal = runs.reduce((s, r) => s + r.total_amount, 0);

  return (
    <div className="text-neutral-900">
      {/* AlertDialog for confirmations */}
      <AlertDialog open={confirmDialog.open} onOpenChange={open => !open && setConfirmDialog(s => ({ ...s, open: false }))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmDialog.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>キャンセル</AlertDialogCancel>
            <AlertDialogAction onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(s => ({ ...s, open: false })); }}>
              実行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}

        <div className="bg-white rounded-lg border border-neutral-200 p-3 mb-3 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm flex items-center gap-3 flex-wrap">
            <div>
              <span className="text-slate-500">対象月:</span>{' '}
              <Input type="month" value={ym} onChange={e => setYm(e.target.value)} className="inline-block w-auto h-7 text-sm" />
            </div>
            <span><span className="text-slate-500">対象者:</span> <span className="font-bold">{runs.length}人</span></span>
            <span><span className="text-slate-500">合計:</span> <span className="font-bold text-orange-700">{yen(grandTotal)}</span></span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={calculate} disabled={busy} size="sm">
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {busy ? '処理中...' : '計算実行'}
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/staff/bank-transfer/payroll?year_month=${ym}`} download>
                <Landmark /> 振込CSV
              </a>
            </Button>
            <Button onClick={uploadAll} disabled={busy || runs.length === 0} variant="outline" size="sm" className="text-emerald-700 border-emerald-300 hover:bg-emerald-50">
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}
              {busy ? '処理中...' : '全員アップ'}
            </Button>
            <Button onClick={confirmAll} disabled={busy || runs.length === 0} variant="secondary" size="sm">
              {busy ? <Loader2 className="animate-spin" /> : <CheckCircle />}
              {busy ? '処理中...' : '全員確定'}
            </Button>
          </div>
        </div>

        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        )}

        {!loading && runs.length === 0 && (
          <p className="text-slate-500 text-sm p-4 bg-white rounded border">この月の計算結果はまだありません。「計算実行」を押してください。</p>
        )}

        {/* スマホ: カード型レイアウト */}
        {runs.length > 0 && (
          <div className="sm:hidden space-y-2.5">
            {runs.map(r => (
              <div key={r.id} className={`rounded-xl p-3 shadow-sm ${r.status === 'confirmed' ? 'bg-emerald-50 border-2 border-emerald-400' : 'bg-white border border-neutral-200'}`}>
                {/* 名前 + バッジ */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-bold text-base">{r.instructor_name}</span>
                    {r.salary_type === 'monthly_fixed' && (
                      <Badge variant="secondary" className="text-[10px]">固定給</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {statusBadge(r.status, !!r.payslip_uploaded_at)}
                  </div>
                </div>

                {/* 合計金額 */}
                <div className="text-2xl font-extrabold text-orange-700 mt-1">{yen(r.total_amount)}</div>

                {/* 内訳 */}
                <div className="text-xs text-slate-500 mt-0.5">
                  レッスン{yen(r.total_lesson_amount)} / 交通{yen(r.total_transit_amount)} / 調整{r.total_adjustment_amount !== 0 ? yen(r.total_adjustment_amount) : '--'}
                </div>

                {/* ボタン */}
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" className="flex-1" asChild>
                    <a href={previewUrl(r)} target="_blank" rel="noopener noreferrer">
                      <Eye /> プレビュー
                    </a>
                  </Button>
                  <Button onClick={() => uploadOne(r.id).then(() => load(ym))} disabled={!!rowBusy[r.id]}
                    size="sm" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white">
                    {rowBusy[r.id] === 'up' ? <Loader2 className="animate-spin" /> : <ArrowUpFromLine />}
                    {rowBusy[r.id] === 'up' ? 'アップ中...' : r.drive_file_id ? '再アップ' : 'アップ'}
                  </Button>
                  {r.drive_file_id && (
                    <Button onClick={() => deleteOne(r.id)} disabled={!!rowBusy[r.id]}
                      variant="destructive" size="icon-xs">
                      {rowBusy[r.id] === 'del' ? <Loader2 className="animate-spin" /> : <Trash2 />}
                    </Button>
                  )}
                </div>

                {/* 状態変更 */}
                {r.status === 'draft' && (
                  <Button onClick={() => changeStatus(r.id, 'confirmed')} disabled={!!rowBusy[r.id]}
                    size="sm" className="mt-2 w-full">
                    <CheckCircle /> 確定する
                  </Button>
                )}
                {r.status === 'confirmed' && (
                  <Button onClick={() => changeStatus(r.id, 'draft')} disabled={!!rowBusy[r.id]}
                    variant="outline" size="sm" className="mt-2 w-full text-xs">
                    下書きに戻す
                  </Button>
                )}

                {/* 詳細リンク */}
                <div className="text-right mt-1.5">
                  <Button variant="link" size="xs" onClick={() => openDetail(r.id)} className="text-slate-400 hover:text-slate-600">
                    詳細を見る &rsaquo;
                  </Button>
                </div>
              </div>
            ))}

            {/* 合計ミニカード */}
            <div className="bg-slate-50 rounded-xl border border-neutral-200 p-3 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">レッスン計</span><span className="font-mono">{yen(runs.reduce((s, r) => s + r.total_lesson_amount, 0))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">交通計</span><span className="font-mono">{yen(runs.reduce((s, r) => s + r.total_transit_amount, 0))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">調整計</span><span className="font-mono">{yen(runs.reduce((s, r) => s + r.total_adjustment_amount, 0))}</span></div>
              <div className="flex justify-between border-t mt-1 pt-1 font-bold"><span>合計</span><span className="font-mono text-orange-700">{yen(grandTotal)}</span></div>
            </div>
          </div>
        )}

        {/* PC: テーブル */}
        {runs.length > 0 && (
          <div className="hidden sm:block bg-white rounded-lg border border-neutral-200">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">インストラクター</TableHead>
                  <TableHead className="text-right whitespace-nowrap">レッスン</TableHead>
                  <TableHead className="text-right whitespace-nowrap">交通費</TableHead>
                  <TableHead className="text-right whitespace-nowrap">調整</TableHead>
                  <TableHead className="text-right font-bold whitespace-nowrap">合計</TableHead>
                  <TableHead className="text-center whitespace-nowrap">状態</TableHead>
                  <TableHead className="text-center whitespace-nowrap">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id} className="hover:bg-orange-50/50 cursor-pointer" onClick={() => openDetail(r.id)}>
                    <TableCell className="font-semibold whitespace-nowrap">
                      {r.instructor_name}
                      {r.salary_type === 'monthly_fixed' && <Badge variant="secondary" className="ml-1 text-[9px]">固定給</Badge>}
                    </TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{yen(r.total_lesson_amount)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{yen(r.total_transit_amount)}</TableCell>
                    <TableCell className="text-right font-mono whitespace-nowrap">{r.total_adjustment_amount !== 0 ? yen(r.total_adjustment_amount) : '--'}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-orange-700 whitespace-nowrap">{yen(r.total_amount)}</TableCell>
                    <TableCell className="text-center">
                      {statusBadge(r.status, !!r.payslip_uploaded_at)}
                    </TableCell>
                    <TableCell className="text-center text-xs whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon-xs" asChild>
                        <a href={previewUrl(r)} target="_blank" rel="noopener noreferrer" title="PDFプレビュー"><Eye className="size-3.5" /></a>
                      </Button>
                      <Button variant="ghost" size="icon-xs" onClick={() => uploadOne(r.id).then(() => load(ym))} disabled={!!rowBusy[r.id]} title={r.drive_file_id ? '再アップ' : 'アップ'}>
                        {rowBusy[r.id] === "up" ? <Loader2 className="size-3.5 animate-spin" /> : <ArrowUpFromLine className="size-3.5 text-emerald-700" />}
                      </Button>
                      {r.drive_file_id && (
                        <>
                          {r.pdf_url && (
                            <Button variant="ghost" size="icon-xs" asChild>
                              <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" title="Driveで開く"><FolderOpen className="size-3.5" /></a>
                            </Button>
                          )}
                          <Button variant="ghost" size="icon-xs" onClick={() => deleteOne(r.id)} disabled={!!rowBusy[r.id]} title="削除">
                            {rowBusy[r.id] === "del" ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5 text-red-600" />}
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="whitespace-nowrap font-bold">合計</TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">{yen(runs.reduce((s, r) => s + r.total_lesson_amount, 0))}</TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">{yen(runs.reduce((s, r) => s + r.total_transit_amount, 0))}</TableCell>
                  <TableCell className="text-right font-mono whitespace-nowrap">{yen(runs.reduce((s, r) => s + r.total_adjustment_amount, 0))}</TableCell>
                  <TableCell className="text-right font-mono text-orange-700 whitespace-nowrap">{yen(grandTotal)}</TableCell>
                  <TableCell colSpan={2}></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}

        {runs[0]?.payment_date && (
          <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
            <CalendarDays className="size-3" /> 振込予定日: {runs[0].payment_date}
          </p>
        )}
      </div>

      {/* 詳細ダイアログ */}
      <Dialog open={!!detail} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail?.run.instructor_name} <span className="text-slate-400 text-sm font-normal">/ {detail?.run.year_month}</span>
            </DialogTitle>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              {/* サマリ */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-[10px] text-slate-500">レッスン</div>
                  <div className="font-bold">{yen(detail.run.total_lesson_amount)}</div>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-[10px] text-slate-500">交通費</div>
                  <div className="font-bold">{yen(detail.run.total_transit_amount)}</div>
                </div>
                <div className="bg-slate-50 rounded p-2">
                  <div className="text-[10px] text-slate-500">調整</div>
                  <div className="font-bold">{yen(detail.run.total_adjustment_amount)}</div>
                </div>
                <div className="bg-orange-50 rounded p-2">
                  <div className="text-[10px] text-orange-600">合計</div>
                  <div className="font-bold text-orange-700">{yen(detail.run.total_amount)}</div>
                </div>
              </div>

              {/* レッスン明細 */}
              <div>
                <h4 className="font-bold text-sm mb-1">レッスン明細 ({detail.lines.length}件)</h4>
                <div className="border rounded overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">日付</TableHead>
                        <TableHead className="text-xs">クラス</TableHead>
                        <TableHead className="text-xs">スタジオ</TableHead>
                        <TableHead className="text-xs text-right">単価</TableHead>
                        <TableHead className="text-xs text-right">交通費</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.map(l => (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs font-mono">{l.lesson_date}</TableCell>
                          <TableCell className="text-xs">{l.class_name ?? '--'}</TableCell>
                          <TableCell className="text-xs text-slate-500">{l.studio_name ?? '--'}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{yen(l.lesson_rate)}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{l.transit_fee ? yen(l.transit_fee) : '--'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* 調整項目 */}
              <div>
                <h4 className="font-bold text-sm mb-1">調整項目</h4>
                {detail.adjustments.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {detail.adjustments.map(a => (
                      <div key={a.id} className="flex items-center justify-between bg-slate-50 rounded px-2 py-1 text-xs">
                        <div>
                          <span className="font-semibold">{ADJ_TYPES.find(t => t.value === a.adjustment_type)?.label ?? a.adjustment_type}</span>
                          <span className="ml-2 text-slate-600">{a.description}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold ${a.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>{yen(a.amount)}</span>
                          <Button variant="ghost" size="xs" onClick={() => deleteAdjustment(a.id)} className="text-slate-400 hover:text-red-600">
                            <Trash2 className="size-3" /> 削除
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="bg-orange-50 border border-orange-200 rounded p-2 grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <Select value={adjForm.type} onValueChange={v => setAdjForm({ ...adjForm, type: v })}>
                    <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ADJ_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input type="number" placeholder="金額(+-)" value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })} className="h-7 text-xs" />
                  <Input placeholder="説明" value={adjForm.description} onChange={e => setAdjForm({ ...adjForm, description: e.target.value })} className="h-7 text-xs sm:col-span-1" />
                  <Button onClick={addAdjustment} size="sm">追加</Button>
                </div>
              </div>

              {/* ステータス操作 */}
              <div className="flex gap-2 pt-2 border-t flex-wrap">
                <span className="text-xs text-slate-500 self-center">状態:</span>
                <Button onClick={() => updateStatus(detail.run.id, 'draft')} variant={detail.run.status === 'draft' ? 'secondary' : 'ghost'} size="xs">下書き</Button>
                <Button onClick={() => updateStatus(detail.run.id, 'confirmed')} variant={detail.run.status === 'confirmed' ? 'secondary' : 'ghost'} size="xs">確定</Button>
                <Button onClick={() => updateStatus(detail.run.id, 'paid')} variant={detail.run.status === 'paid' ? 'secondary' : 'ghost'} size="xs">振込済</Button>
                <div className="ml-auto flex gap-2">
                  <Button variant="secondary" size="xs" asChild>
                    <a href={`/staff/payroll/${detail.run.id}/print`} target="_blank" rel="noopener noreferrer">
                      <Printer className="size-3" /> 明細書印刷
                    </a>
                  </Button>
                  {detail.run.payslip_folder_url && (
                    <Button variant="outline" size="xs" asChild>
                      <a href={detail.run.payslip_folder_url} target="_blank" rel="noopener noreferrer">
                        <FolderOpen className="size-3" /> Drive
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
