'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

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
  const [tab, setTab] = useState<'expenses' | 'pending' | 'add'>('expenses');
  const [err, setErr] = useState('');

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
    const res = await fetch('/api/staff/expenses/confirm-bank', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txn_id: txnId, category }),
    });
    if (res.ok) await load(ym);
    else alert(`エラー: ${await res.text()}`);
  };

  const deleteExpense = async (id: number) => {
    if (!confirm('この経費を削除しますか?')) return;
    await fetch(`/api/staff/expenses?id=${id}`, { method: 'DELETE', credentials: 'include' });
    await load(ym);
  };

  const totalExpense = data?.expenses.reduce((s, e) => s + e.amount, 0) ?? 0;

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader
        title="💸 経費管理"
        description="銀行明細→確定→経費 / 手動入力 / カテゴリ別集計"
        rightExtra={
          <input type="month" value={ym} onChange={e => setYm(e.target.value)} className="px-2 py-1 border border-slate-300 rounded text-sm" />
        }
      />

      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}

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
        <div className="flex gap-1 mb-2 border-b">
          {[
            { k: 'expenses', label: `📋 経費一覧 (${data?.expenses.length ?? 0})` },
            { k: 'pending', label: `🏦 銀行明細 未確定 (${data?.pendingBankTxns.length ?? 0})` },
            { k: 'add', label: '➕ 手動追加' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k as 'expenses' | 'pending' | 'add')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 transition-colors ${tab === t.k ? 'border-orange-500 text-orange-700 bg-orange-50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-slate-500 text-sm">読込中...</p>}

        {/* 経費一覧 */}
        {!loading && data && tab === 'expenses' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-2 py-1 text-left">日付</th>
                  <th className="px-2 py-1 text-left">カテゴリ</th>
                  <th className="px-2 py-1 text-left">サブ</th>
                  <th className="px-2 py-1 text-left">摘要</th>
                  <th className="px-2 py-1 text-left">ソース</th>
                  <th className="px-2 py-1 text-right">金額</th>
                  <th className="px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {data.expenses.map(e => (
                  <tr key={e.id} className="border-b hover:bg-slate-50">
                    <td className="px-2 py-1 font-mono">{e.expense_date}</td>
                    <td className="px-2 py-1"><span className="text-[10px] px-1 bg-orange-100 text-orange-700 rounded">{e.category}</span></td>
                    <td className="px-2 py-1 text-slate-600">{e.subcategory ?? '—'}</td>
                    <td className="px-2 py-1 text-slate-600 max-w-xs truncate">{e.description ?? '—'}</td>
                    <td className="px-2 py-1 text-[10px] text-slate-400">{e.source}</td>
                    <td className="px-2 py-1 text-right font-mono font-bold">{yen(e.amount)}</td>
                    <td className="px-2 py-1"><button onClick={() => deleteExpense(e.id)} className="text-slate-400 hover:text-red-600">削除</button></td>
                  </tr>
                ))}
                {data.expenses.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-slate-400">経費未登録</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* 未確定銀行明細 */}
        {!loading && data && tab === 'pending' && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-2 py-1 text-left">日付</th>
                  <th className="px-2 py-1 text-left">摘要</th>
                  <th className="px-2 py-1 text-left">振込先</th>
                  <th className="px-2 py-1 text-right">金額</th>
                  <th className="px-2 py-1 text-left">推定</th>
                  <th className="px-2 py-1 text-left">経費登録</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingBankTxns.map(t => (
                  <tr key={t.id} className="border-b">
                    <td className="px-2 py-1 font-mono">{t.txn_date}</td>
                    <td className="px-2 py-1 max-w-xs truncate">{t.description ?? '—'}</td>
                    <td className="px-2 py-1 text-slate-500">{t.counterparty ?? '—'}</td>
                    <td className={`px-2 py-1 text-right font-mono ${t.amount < 0 ? 'text-red-700' : 'text-green-700'}`}>{yen(Math.abs(t.amount))}</td>
                    <td className="px-2 py-1">
                      {t.expense_category && <span className="text-[10px] px-1 bg-amber-100 text-amber-700 rounded">{t.expense_category}</span>}
                    </td>
                    <td className="px-2 py-1">
                      {t.amount < 0 ? (
                        <select defaultValue={t.expense_category ?? ''} onChange={e => confirmTxn(t.id, e.target.value)} className="px-1 py-0.5 border rounded text-[10px]">
                          <option value="">確定...</option>
                          {data.categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      ) : <span className="text-[10px] text-slate-400">入金</span>}
                    </td>
                  </tr>
                ))}
                {data.pendingBankTxns.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-400">未確定の銀行明細なし (経営インサイト画面で銀行CSV取込)</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {/* 手動追加 */}
        {!loading && data && tab === 'add' && (
          <ManualAddForm categories={data.categories} onAdded={() => load(ym)} defaultDate={ym} />
        )}
      </div>
    </main>
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
          <label className="text-[10px] text-slate-500">日付</label>
          <input type="date" value={form.expense_date} onChange={e => setForm({ ...form, expense_date: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">カテゴリ</label>
          <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full px-2 py-1 border rounded text-sm">
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[10px] text-slate-500">サブカテゴリ (媒体/サブスク名等)</label>
          <input value={form.subcategory} onChange={e => setForm({ ...form, subcategory: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" placeholder="例: Google Ads / Vercel" />
        </div>
        <div>
          <label className="text-[10px] text-slate-500">金額 (税込)</label>
          <input type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" placeholder="0" />
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-slate-500">摘要</label>
          <input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full px-2 py-1 border rounded text-sm" />
        </div>
        <div className="col-span-2">
          <label className="text-xs">
            <input type="checkbox" checked={form.is_recurring} onChange={e => setForm({ ...form, is_recurring: e.target.checked })} className="mr-1" />
            毎月の固定費 (将来自動計上対象)
          </label>
        </div>
      </div>
      <button onClick={submit} disabled={busy} className="mt-3 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-semibold disabled:opacity-50">
        {busy ? '登録中...' : '➕ 経費を追加'}
      </button>
    </div>
  );
}
