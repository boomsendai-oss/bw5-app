'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Trash2, Plus, RefreshCw, Loader2, ClipboardList, Landmark, PinIcon, ReceiptText } from 'lucide-react';

type Expense = {
  id: number;
  expense_date: string;
  category: string;
  subcategory: string | null;
  amount: number;
  description: string | null;
  source: string;
  is_recurring: number;
};

type BankTxn = {
  id: number;
  txn_date: string;
  amount: number;
  description: string | null;
  counterparty: string | null;
  balance_after: number | null;
  expense_category: string | null;
  confirmed: number;
};

type SummaryRow = { category: string; total: number; count: number };

type Data = {
  expenses: Expense[];
  summary: SummaryRow[];
  pendingBankTxns: BankTxn[];
  categories: string[];
};

function yen(n: number): string { return `¥${Number(n).toLocaleString('ja-JP')}`; }
function prevYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function ExpensesPage() {
  const [ym, setYm] = useState(prevYM());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('expenses');
  const [err, setErr] = useState('');

  // AlertDialog state
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} });

  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, title, description, onConfirm });
  };

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/staff/expenses?year_month=${target}`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/staff/events/login?next=/staff/expenses'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(ym); }, [ym, load]);

  const confirmTxn = async (txnId: number, category: string) => {
    if (!category) return;
    setData(prev => prev ? {
      ...prev,
      pendingBankTxns: prev.pendingBankTxns.filter(t => t.id !== txnId),
    } : prev);
    try {
      const res = await fetch('/api/staff/expenses/confirm-bank', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ txn_id: txnId, category }),
      });
      if (!res.ok) throw new Error(await res.text());
      load(ym);
    } catch (e) {
      setErr(`確定失敗: ${e instanceof Error ? e.message : String(e)}`);
      load(ym);
    }
  };

  const deleteExpense = async (id: number) => {
    showConfirm(
      '経費削除',
      'この経費を削除しますか?',
      async () => {
        setData(prev => prev ? {
          ...prev,
          expenses: prev.expenses.filter(e => e.id !== id),
        } : prev);
        try {
          const res = await fetch(`/api/staff/expenses?id=${id}`, { method: 'DELETE', credentials: 'include' });
          if (!res.ok) throw new Error(await res.text());
          load(ym);
        } catch (e) {
          setErr(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
          load(ym);
        }
      }
    );
  };

  const totalExpense = data?.expenses.reduce((s, e) => s + e.amount, 0) ?? 0;

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

        <div className="flex items-center gap-3 mb-3">
          <Input type="month" value={ym} onChange={e => setYm(e.target.value)} className="w-auto h-7 text-sm" />
        </div>

        {/* サマリ */}
        {data && (
          <div className="bg-white border rounded-lg p-3 mb-3">
            <div className="flex justify-between items-baseline mb-2">
              <h3 className="font-bold text-sm">カテゴリ別集計</h3>
              <div className="text-lg font-bold text-orange-700">{yen(totalExpense)}</div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {data.summary.map(s => (
                <div key={s.category} className="border-l-4 border-orange-200 pl-2 py-1">
                  <div className="text-[10px] text-slate-500">{s.category} ({s.count})</div>
                  <div className="font-bold text-sm">{yen(s.total)}</div>
                </div>
              ))}
              {data.summary.length === 0 && <div className="text-xs text-slate-400 col-span-full">経費未登録</div>}
            </div>
          </div>
        )}

        {/* タブ */}
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-2">
            <TabsTrigger value="expenses">
              <ClipboardList className="size-3.5" /> 経費一覧 ({data?.expenses.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="pending">
              <Landmark className="size-3.5" /> 銀行明細 未確定 ({data?.pendingBankTxns.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="add">
              <Plus className="size-3.5" /> 手動追加
            </TabsTrigger>
            <TabsTrigger value="recurring">
              <RefreshCw className="size-3.5" /> 月次固定費
            </TabsTrigger>
          </TabsList>

          {loading && (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {/* 経費一覧 */}
          {!loading && data && (
            <TabsContent value="expenses">
              <div className="bg-white rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs whitespace-nowrap">日付</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">カテゴリ</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">サブ</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">摘要</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">ソース</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">金額</TableHead>
                      <TableHead className="text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.expenses.map(e => (
                      <TableRow key={e.id}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{e.expense_date}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap"><Badge variant="outline">{e.category}</Badge></TableCell>
                        <TableCell className="text-xs text-slate-600 whitespace-nowrap">{e.subcategory ?? '--'}</TableCell>
                        <TableCell className="text-xs text-slate-600 max-w-xs truncate">{e.description ?? '--'}</TableCell>
                        <TableCell className="text-[10px] text-slate-400 whitespace-nowrap">{e.source}</TableCell>
                        <TableCell className="text-xs text-right font-mono font-bold whitespace-nowrap">{yen(e.amount)}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          <Button variant="ghost" size="icon-xs" onClick={() => deleteExpense(e.id)}>
                            <Trash2 className="size-3 text-slate-400 hover:text-red-600" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.expenses.length === 0 && (
                      <TableRow><TableCell colSpan={7} className="py-4 text-center text-slate-400">経費未登録</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}

          {/* 未確定銀行明細 */}
          {!loading && data && (
            <TabsContent value="pending">
              <div className="bg-white rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs whitespace-nowrap">日付</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">摘要</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">振込先</TableHead>
                      <TableHead className="text-xs text-right whitespace-nowrap">金額</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">推定</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">経費登録</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pendingBankTxns.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{t.txn_date}</TableCell>
                        <TableCell className="text-xs max-w-xs truncate">{t.description ?? '--'}</TableCell>
                        <TableCell className="text-xs text-slate-500 whitespace-nowrap">{t.counterparty ?? '--'}</TableCell>
                        <TableCell className={`text-xs text-right font-mono whitespace-nowrap ${t.amount < 0 ? 'text-red-700' : 'text-green-700'}`}>{yen(Math.abs(t.amount))}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {t.expense_category && <Badge variant="outline" className="text-amber-700 border-amber-300">{t.expense_category}</Badge>}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap">
                          {t.amount < 0 ? (
                            <select defaultValue={t.expense_category ?? ''} onChange={e => confirmTxn(t.id, e.target.value)} className="px-1 py-0.5 border rounded text-[10px]">
                              <option value="">確定...</option>
                              {data.categories.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : <span className="text-[10px] text-slate-400">入金</span>}
                        </TableCell>
                      </TableRow>
                    ))}
                    {data.pendingBankTxns.length === 0 && (
                      <TableRow><TableCell colSpan={6} className="py-4 text-center text-slate-400">未確定の銀行明細なし (経営インサイト画面で銀行CSV取込)</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>
          )}

          {/* 手動追加 */}
          {!loading && data && (
            <TabsContent value="add">
              <ManualAddForm categories={data.categories} onAdded={() => load(ym)} defaultDate={ym} />
            </TabsContent>
          )}

          {/* 月次固定費 */}
          {!loading && data && (
            <TabsContent value="recurring">
              <RecurringTab categories={data.categories} ym={ym} onChanged={() => load(ym)} />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
}

type RecurringItem = { id: number; category: string; subcategory: string | null; amount: number; budget_amount: number | null; description: string | null; match_pattern: string | null; active: number };

function RecurringTab({ categories, ym, onChanged }: { categories: string[]; ym: string; onChanged: () => void }) {
  const [items, setItems] = useState<RecurringItem[]>([]);
  const [form, setForm] = useState({ category: 'システム費', subcategory: '', amount: '', match_pattern: '', description: '' });
  const [busy, setBusy] = useState(false);
  const [applyMsg, setApplyMsg] = useState('');

  // AlertDialog state
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; title: string; description: string; onConfirm: () => void }>({ open: false, title: '', description: '', onConfirm: () => {} });

  const showConfirm = (title: string, description: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, title, description, onConfirm });
  };

  const loadItems = useCallback(async () => {
    const r = await fetch('/api/staff/recurring-expenses', { credentials: 'include' });
    if (r.ok) setItems((await r.json()).items ?? []);
  }, []);
  useEffect(() => {
    let alive = true;
    fetch('/api/staff/recurring-expenses', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (alive && d) setItems(d.items ?? []); });
    return () => { alive = false; };
  }, []);

  const add = async () => {
    const amount = parseInt(form.amount, 10);
    if (isNaN(amount) || amount <= 0) { alert('金額は正の数値で'); return; }
    const tempId = -Date.now();
    const optimisticItem: RecurringItem = {
      id: tempId,
      category: form.category,
      subcategory: form.subcategory || null,
      amount,
      budget_amount: amount,
      description: form.description || null,
      match_pattern: form.match_pattern || null,
      active: 1,
    };
    setItems(prev => [...prev, optimisticItem]);
    const snapshot = form;
    setForm({ category: 'システム費', subcategory: '', amount: '', match_pattern: '', description: '' });
    setBusy(true);
    try {
      const res = await fetch('/api/staff/recurring-expenses', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...snapshot, amount, budget_amount: amount, active: 1 }),
      });
      if (!res.ok) throw new Error(await res.text());
      loadItems();
    } catch (e) {
      alert(`追加失敗: ${e instanceof Error ? e.message : String(e)}`);
      loadItems();
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    showConfirm(
      '削除確認',
      '削除しますか?',
      async () => {
        setItems(prev => prev.filter(i => i.id !== id));
        try {
          const res = await fetch(`/api/staff/recurring-expenses?id=${id}`, { method: 'DELETE', credentials: 'include' });
          if (!res.ok) throw new Error(await res.text());
          loadItems();
        } catch (e) {
          alert(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
          loadItems();
        }
      }
    );
  };

  const applyForMonth = async () => {
    showConfirm(
      '一括計上',
      `${ym} に固定費${items.length}件を一括計上しますか? (既に計上済みは自動スキップ)`,
      async () => {
        setBusy(true);
        const res = await fetch('/api/staff/expenses/apply-recurring', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ year_month: ym }),
        });
        setBusy(false);
        if (res.ok) {
          const d = await res.json();
          setApplyMsg(`${ym} に ${d.inserted}件 計上 (重複スキップ: ${d.items.filter((i: { skipped: boolean }) => i.skipped).length}件)`);
          onChanged();
        } else { alert(await res.text()); }
      }
    );
  };

  return (
    <div className="space-y-3">
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

      <div className="bg-amber-50 border border-amber-200 rounded p-3">
        <h3 className="font-bold text-sm mb-1 flex items-center gap-1"><PinIcon className="size-3.5" /> 経常費テンプレート (固定費+変動固定費)</h3>
        <p className="text-xs text-slate-600">
          毎月発生する経費 (HACOMONO/Lstep/Vercel等)。<strong className="text-amber-800">摘要マッチパターン</strong>を入れておくと、銀行明細CSV取込時に該当取引を実額で<strong>自動経費登録</strong>。<br />
          金額は「予算/目安」として扱い、実際は銀行明細の実額が記録されます。
        </p>
        <Button onClick={applyForMonth} disabled={busy || items.length === 0} size="sm" className="mt-2">
          {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          {ym} に予算で一括計上 ({items.length}件) -- 銀行明細マッチがなかった場合のフォールバック
        </Button>
        {applyMsg && <p className="text-xs text-green-700 mt-2">{applyMsg}</p>}
      </div>

      {/* 追加フォーム */}
      <div className="bg-white border rounded p-3">
        <h4 className="text-xs font-bold mb-2 flex items-center gap-1"><Plus className="size-3" /> 新規追加</h4>
        <div className="grid grid-cols-1 sm:grid-cols-6 gap-2 text-sm">
          <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
            <SelectTrigger size="sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input placeholder="サブ (Vercel等)" value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} className="h-7 text-sm" />
          <Input type="number" placeholder="予算/目安額" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="h-7 text-sm" />
          <Input placeholder="摘要マッチ (例: HACOMONO)" value={form.match_pattern} onChange={e => setForm({ ...form, match_pattern: e.target.value })} className="h-7 text-sm" title="銀行明細の摘要にこの文字列が含まれていたら自動で経費確定" />
          <Input placeholder="説明" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="h-7 text-sm sm:col-span-1" />
          <Button onClick={add} disabled={busy} size="sm">追加</Button>
        </div>
      </div>

      {/* 一覧 */}
      <div className="bg-white border rounded">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs whitespace-nowrap">カテゴリ</TableHead>
              <TableHead className="text-xs whitespace-nowrap">サブ</TableHead>
              <TableHead className="text-xs whitespace-nowrap">摘要マッチ</TableHead>
              <TableHead className="text-xs whitespace-nowrap">説明</TableHead>
              <TableHead className="text-xs text-right whitespace-nowrap">予算</TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map(i => (
              <TableRow key={i.id}>
                <TableCell className="text-xs whitespace-nowrap"><Badge variant="outline">{i.category}</Badge></TableCell>
                <TableCell className="text-xs whitespace-nowrap">{i.subcategory ?? '--'}</TableCell>
                <TableCell className="text-xs text-blue-700 font-mono whitespace-nowrap">{i.match_pattern ?? '--'}</TableCell>
                <TableCell className="text-xs text-slate-600 max-w-xs truncate">{i.description ?? '--'}</TableCell>
                <TableCell className="text-xs text-right font-mono whitespace-nowrap">{yen(i.amount)}/月</TableCell>
                <TableCell className="text-xs whitespace-nowrap">
                  <Button variant="ghost" size="icon-xs" onClick={() => del(i.id)}>
                    <Trash2 className="size-3 text-slate-400 hover:text-red-600" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-4 text-center text-slate-400">未登録</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ManualAddForm({ categories, onAdded, defaultDate }: { categories: string[]; onAdded: () => void; defaultDate: string }) {
  const [form, setForm] = useState({
    expense_date: `${defaultDate}-01`,
    category: '広告費',
    subcategory: '',
    amount: '',
    description: '',
    is_recurring: false,
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const amount = parseInt(form.amount, 10);
    if (isNaN(amount) || amount <= 0) { alert('金額は正の数値で'); return; }
    setBusy(true);
    const res = await fetch('/api/staff/expenses', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        expense_date: form.expense_date,
        category: form.category,
        subcategory: form.subcategory || null,
        amount,
        description: form.description || null,
        is_recurring: form.is_recurring,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setForm({ ...form, amount: '', description: '', subcategory: '' });
      onAdded();
    } else {
      alert(`エラー: ${await res.text()}`);
    }
  };

  return (
    <div className="bg-white border rounded-lg p-4 max-w-xl">
      <h3 className="font-bold text-sm mb-3">手動で経費を追加</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-[10px] text-slate-500">日付</Label>
          <Input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} className="h-8 text-sm" />
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">カテゴリ</Label>
          <Select value={form.category} onValueChange={v => setForm({ ...form, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">サブカテゴリ (媒体/サブスク名等)</Label>
          <Input value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} className="h-8 text-sm" placeholder="例: Google Ads / Vercel" />
        </div>
        <div>
          <Label className="text-[10px] text-slate-500">金額 (税込)</Label>
          <Input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="h-8 text-sm" placeholder="0" />
        </div>
        <div className="col-span-2">
          <Label className="text-[10px] text-slate-500">摘要</Label>
          <Input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="h-8 text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-xs flex items-center gap-1.5">
            <input type="checkbox" checked={form.is_recurring} onChange={e => setForm({ ...form, is_recurring: e.target.checked })} className="rounded" />
            毎月の固定費 (将来自動計上対象)
          </label>
        </div>
      </div>
      <Button onClick={submit} disabled={busy} size="sm" className="mt-3">
        {busy ? <Loader2 className="animate-spin" /> : <Plus />}
        {busy ? '登録中...' : '経費を追加'}
      </Button>
    </div>
  );
}
