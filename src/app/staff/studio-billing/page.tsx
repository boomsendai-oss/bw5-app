'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { RefreshCw, Landmark, Trash2, Loader2 } from 'lucide-react';
import { yen } from '@/lib/utils';

type Run = {
  id: number;
  year_month: string;
  studio_id: number;
  studio_name: string;
  pricing_model: string;
  payment_type: string;
  total_hours: number;
  total_lesson_amount: number;
  total_adjustment_amount: number;
  total_amount: number;
  payment_date: string | null;
  status: string;
};

type Line = {
  id: number; lesson_date: string; class_name: string | null;
  hours: number; hourly_rate: number; amount: number; source: string;
};

type Adj = { id: number; adjustment_type: string; amount: number; description: string };

type Detail = { run: Run; lines: Line[]; adjustments: Adj[] };

const ADJ_TYPES = [
  { value: 'cancellation_fee', label: 'キャンセル料' },
  { value: 'extra_rental', label: '追加レンタル' },
  { value: 'discount', label: '値引き' },
  { value: 'other', label: 'その他' },
];

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  prepaid_bank: '事前振込',
  postpaid_bank: '事後振込',
  cash_per_use: '都度現金',
  postpaid_public: '公共施設',
};

function hrs(n: number | null | undefined): string {
  const v = Number(n);
  return `${(Number.isFinite(v) ? v : 0).toFixed(1)}h`;
}
function prevYM(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function statusBadge(status: string) {
  return (
    <Badge variant={status === 'paid' ? 'default' : status === 'confirmed' ? 'secondary' : 'outline'}>
      {status === 'paid' ? '振込済' : status === 'confirmed' ? '確定' : '下書き'}
    </Badge>
  );
}

export default function StudioBillingPage() {
  const [ym, setYm] = useState(prevYM());
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [adjForm, setAdjForm] = useState({ type: 'cancellation_fee', amount: '', description: '' });

  // AlertDialog state
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} });

  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, title, description, onConfirm });
  };

  const load = useCallback(async (target: string) => {
    setLoading(true); setErr('');
    try {
      const res = await fetch(`/api/staff/studio-billing?year_month=${target}`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/staff/events/login?next=/staff/studio-billing'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setRuns(d.runs ?? []);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(ym); }, [ym, load]);

  const calculate = async () => {
    showConfirm(
      'スタジオ料計算',
      `${ym} のスタジオ料を計算します。draft状態は上書きされます。`,
      async () => {
        setBusy(true); setErr('');
        try {
          const res = await fetch('/api/staff/studio-billing/calculate', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ year_month: ym }),
          });
          if (!res.ok) throw new Error(await res.text());
          load(ym);
        } catch (e) {
          setErr(e instanceof Error ? e.message : String(e));
          load(ym);
        }
        finally { setBusy(false); }
      }
    );
  };

  const openDetail = async (runId: number) => {
    const res = await fetch(`/api/staff/studio-billing/${runId}`, { credentials: 'include' });
    if (res.ok) setDetail(await res.json());
  };

  const addAdj = async () => {
    if (!detail) return;
    const amount = parseInt(adjForm.amount, 10);
    if (isNaN(amount) || !adjForm.description.trim()) { alert('金額(数値)と説明を入力'); return; }
    const snapForm = { ...adjForm };
    const snapDetail = detail;
    const runId = detail.run.id;
    const tempId = -Date.now();
    const optimisticAdj: Adj = {
      id: tempId,
      adjustment_type: snapForm.type,
      amount,
      description: snapForm.description.trim(),
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
    setAdjForm({ type: 'cancellation_fee', amount: '', description: '' });
    try {
      const res = await fetch(`/api/staff/studio-billing/${runId}/adjustments`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adjustment_type: snapForm.type, amount, description: snapForm.description.trim() }),
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

  const delAdj = async (adjId: number) => {
    if (!detail) return;
    showConfirm(
      '調整項目削除',
      '削除しますか?',
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
          const res = await fetch(`/api/staff/studio-billing/${runId}/adjustments?adj_id=${adjId}`, { method: 'DELETE', credentials: 'include' });
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
      const res = await fetch(`/api/staff/studio-billing/${runId}`, {
        method: 'PATCH', credentials: 'include',
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
            <span><span className="text-slate-500">対象スタジオ:</span> <span className="font-bold">{runs.length}</span></span>
            <span><span className="text-slate-500">合計:</span> <span className="font-bold text-orange-700">{yen(grandTotal)}</span></span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Button onClick={calculate} disabled={busy} size="sm">
              {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              {busy ? '計算中...' : '計算実行'}
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <a href={`/api/staff/bank-transfer/studio?year_month=${ym}`} download>
                <Landmark /> 振込CSV (SJIS)
              </a>
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

        {!loading && runs.length === 0 && <p className="text-slate-500 text-sm p-4 bg-white rounded border">未計算。「計算実行」を押してください。</p>}

        {runs.length > 0 && (
          <div className="bg-white rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>スタジオ</TableHead>
                  <TableHead className="text-center">支払</TableHead>
                  <TableHead className="text-right">使用時間</TableHead>
                  <TableHead className="text-right">レンタル料</TableHead>
                  <TableHead className="text-right">調整</TableHead>
                  <TableHead className="text-right font-bold">合計</TableHead>
                  <TableHead className="text-center">振込予定</TableHead>
                  <TableHead className="text-center">状態</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map(r => (
                  <TableRow key={r.id} onClick={() => openDetail(r.id)} className="hover:bg-orange-50/50 cursor-pointer">
                    <TableCell className="font-semibold">{r.studio_name}</TableCell>
                    <TableCell className="text-center"><Badge variant="outline" className="text-[10px]">{PAYMENT_TYPE_LABELS[r.payment_type] ?? r.payment_type}</Badge></TableCell>
                    <TableCell className="text-right font-mono">{hrs(r.total_hours)}</TableCell>
                    <TableCell className="text-right font-mono">{yen(r.total_lesson_amount)}</TableCell>
                    <TableCell className="text-right font-mono">{r.total_adjustment_amount !== 0 ? yen(r.total_adjustment_amount) : '--'}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-orange-700">{yen(r.total_amount)}</TableCell>
                    <TableCell className="text-center text-xs font-mono text-slate-500">{r.payment_date ?? '--'}</TableCell>
                    <TableCell className="text-center">{statusBadge(r.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">合計</TableCell>
                  <TableCell></TableCell>
                  <TableCell className="text-right font-mono">{hrs(runs.reduce((s, r) => s + Number(r.total_hours ?? 0), 0))}</TableCell>
                  <TableCell className="text-right font-mono">{yen(runs.reduce((s, r) => s + r.total_lesson_amount, 0))}</TableCell>
                  <TableCell className="text-right font-mono">{yen(runs.reduce((s, r) => s + r.total_adjustment_amount, 0))}</TableCell>
                  <TableCell className="text-right font-mono text-orange-700">{yen(grandTotal)}</TableCell>
                  <TableCell colSpan={2}></TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        )}
      </div>

      {/* 詳細ダイアログ */}
      <Dialog open={!!detail} onOpenChange={open => !open && setDetail(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail?.run.studio_name} <span className="text-slate-400 text-sm font-normal">/ {detail?.run.year_month}</span>
            </DialogTitle>
          </DialogHeader>

          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">使用時間</div><div className="font-bold">{hrs(detail.run.total_hours)}</div></div>
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">レンタル料</div><div className="font-bold">{yen(detail.run.total_lesson_amount)}</div></div>
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">調整</div><div className="font-bold">{yen(detail.run.total_adjustment_amount)}</div></div>
                <div className="bg-orange-50 rounded p-2"><div className="text-[10px] text-orange-600">合計</div><div className="font-bold text-orange-700">{yen(detail.run.total_amount)}</div></div>
              </div>

              <div>
                <h4 className="font-bold text-sm mb-1">レッスン明細 ({detail.lines.length}件)</h4>
                <div className="border rounded overflow-hidden max-h-64 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs sticky top-0 bg-slate-50">日付</TableHead>
                        <TableHead className="text-xs sticky top-0 bg-slate-50">クラス</TableHead>
                        <TableHead className="text-xs text-right sticky top-0 bg-slate-50">時間</TableHead>
                        <TableHead className="text-xs text-right sticky top-0 bg-slate-50">単価</TableHead>
                        <TableHead className="text-xs text-right sticky top-0 bg-slate-50">金額</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {detail.lines.map(l => (
                        <TableRow key={l.id}>
                          <TableCell className="text-xs font-mono">{l.lesson_date}</TableCell>
                          <TableCell className="text-xs">{l.class_name ?? '--'}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{hrs(l.hours)}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{yen(l.hourly_rate)}</TableCell>
                          <TableCell className="text-xs text-right font-mono">{yen(l.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-sm mb-1">調整項目</h4>
                {detail.adjustments.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {detail.adjustments.map(a => (
                      <div key={a.id} className="flex items-center justify-between bg-slate-50 rounded px-2 py-1 text-xs">
                        <div><span className="font-semibold">{ADJ_TYPES.find(t => t.value === a.adjustment_type)?.label}</span><span className="ml-2 text-slate-600">{a.description}</span></div>
                        <div className="flex items-center gap-2">
                          <span className={`font-mono font-bold ${a.amount >= 0 ? 'text-red-700' : 'text-green-700'}`}>{yen(a.amount)}</span>
                          <Button variant="ghost" size="xs" onClick={() => delAdj(a.id)} className="text-slate-400 hover:text-red-600">
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
                  <Input placeholder="説明" value={adjForm.description} onChange={e => setAdjForm({ ...adjForm, description: e.target.value })} className="h-7 text-xs" />
                  <Button onClick={addAdj} size="sm">追加</Button>
                </div>
              </div>

              <div className="flex gap-2 pt-2 border-t">
                <span className="text-xs text-slate-500 self-center">状態:</span>
                <Button onClick={() => updateStatus(detail.run.id, 'draft')} variant={detail.run.status === 'draft' ? 'secondary' : 'ghost'} size="xs">下書き</Button>
                <Button onClick={() => updateStatus(detail.run.id, 'confirmed')} variant={detail.run.status === 'confirmed' ? 'secondary' : 'ghost'} size="xs">確定</Button>
                <Button onClick={() => updateStatus(detail.run.id, 'paid')} variant={detail.run.status === 'paid' ? 'secondary' : 'ghost'} size="xs">振込済</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
