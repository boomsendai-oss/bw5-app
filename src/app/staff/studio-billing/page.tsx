'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

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

function yen(n: number): string { return `¥${Number(n).toLocaleString('ja-JP')}`; }
function prevYM(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function StudioBillingPage() {
  const [ym, setYm] = useState(prevYM());
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [adjForm, setAdjForm] = useState({ type: 'cancellation_fee', amount: '', description: '' });

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
    if (!confirm(`${ym} のスタジオ料を計算します。draft状態は上書きされます。`)) return;
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/staff/studio-billing/calculate', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_month: ym }),
      });
      if (!res.ok) throw new Error(await res.text());
      await load(ym);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const openDetail = async (runId: number) => {
    const res = await fetch(`/api/staff/studio-billing/${runId}`, { credentials: 'include' });
    if (res.ok) setDetail(await res.json());
  };

  const addAdj = async () => {
    if (!detail) return;
    const amount = parseInt(adjForm.amount, 10);
    if (isNaN(amount) || !adjForm.description.trim()) { alert('金額(数値)と説明を入力'); return; }
    await fetch(`/api/staff/studio-billing/${detail.run.id}/adjustments`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adjustment_type: adjForm.type, amount, description: adjForm.description.trim() }),
    });
    setAdjForm({ type: 'cancellation_fee', amount: '', description: '' });
    await openDetail(detail.run.id);
    await load(ym);
  };
  const delAdj = async (adjId: number) => {
    if (!detail || !confirm('削除しますか?')) return;
    await fetch(`/api/staff/studio-billing/${detail.run.id}/adjustments?adj_id=${adjId}`, { method: 'DELETE', credentials: 'include' });
    await openDetail(detail.run.id);
    await load(ym);
  };
  const updateStatus = async (runId: number, status: string) => {
    await fetch(`/api/staff/studio-billing/${runId}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (detail?.run.id === runId) await openDetail(runId);
    await load(ym);
  };

  const grandTotal = runs.reduce((s, r) => s + r.total_amount, 0);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader
        title="🏠 月次スタジオ料金"
        description="レッスン時間×スタジオ料金 → 確定 → 振込"
        rightExtra={<input type="month" value={ym} onChange={e => setYm(e.target.value)} className="px-2 py-1 border border-slate-300 rounded text-sm" />}
      />
      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}
        <div className="bg-white rounded-lg border border-neutral-200 p-3 mb-3 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm">
            <span className="text-slate-500">対象月:</span> <span className="font-bold text-orange-700">{ym}</span>
            <span className="ml-3 text-slate-500">対象スタジオ:</span> <span className="font-bold">{runs.length}</span>
            <span className="ml-3 text-slate-500">合計:</span> <span className="font-bold text-orange-700">{yen(grandTotal)}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={calculate} disabled={busy} className="px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50">
              {busy ? '計算中...' : '🔄 計算実行'}
            </button>
            <a href={`/api/staff/bank-transfer/studio?year_month=${ym}`} download
              className="px-3 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold">
              🏦 振込CSV (SJIS)
            </a>
          </div>
        </div>
        {loading && <p className="text-slate-500 text-sm">読込中...</p>}
        {!loading && runs.length === 0 && <p className="text-slate-500 text-sm p-4 bg-white rounded border">未計算。「計算実行」を押してください。</p>}
        {runs.length > 0 && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left">スタジオ</th>
                  <th className="px-3 py-2 text-center">支払</th>
                  <th className="px-3 py-2 text-right">使用時間</th>
                  <th className="px-3 py-2 text-right">レンタル料</th>
                  <th className="px-3 py-2 text-right">調整</th>
                  <th className="px-3 py-2 text-right font-bold">合計</th>
                  <th className="px-3 py-2 text-center">振込予定</th>
                  <th className="px-3 py-2 text-center">状態</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} onClick={() => openDetail(r.id)} className="border-b hover:bg-orange-50/50 cursor-pointer">
                    <td className="px-3 py-2 font-semibold">{r.studio_name}</td>
                    <td className="px-3 py-2 text-center text-[10px]"><span className="px-1.5 py-0.5 bg-slate-100 rounded">{PAYMENT_TYPE_LABELS[r.payment_type] ?? r.payment_type}</span></td>
                    <td className="px-3 py-2 text-right font-mono">{r.total_hours.toFixed(1)}h</td>
                    <td className="px-3 py-2 text-right font-mono">{yen(r.total_lesson_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.total_adjustment_amount !== 0 ? yen(r.total_adjustment_amount) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-orange-700">{yen(r.total_amount)}</td>
                    <td className="px-3 py-2 text-center text-xs font-mono text-slate-500">{r.payment_date ?? '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status === 'paid' ? 'bg-green-100 text-green-700' : r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100'}`}>
                        {r.status === 'paid' ? '振込済' : r.status === 'confirmed' ? '確定' : '下書き'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t font-bold">
                <tr>
                  <td className="px-3 py-2">合計</td>
                  <td></td>
                  <td className="px-3 py-2 text-right font-mono">{runs.reduce((s, r) => s + r.total_hours, 0).toFixed(1)}h</td>
                  <td className="px-3 py-2 text-right font-mono">{yen(runs.reduce((s, r) => s + r.total_lesson_amount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono">{yen(runs.reduce((s, r) => s + r.total_adjustment_amount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono text-orange-700">{yen(grandTotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-3xl rounded-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold">{detail.run.studio_name} <span className="text-slate-400 text-sm">/ {detail.run.year_month}</span></h3>
              <button onClick={() => setDetail(null)} className="text-2xl text-slate-400 hover:text-slate-700 leading-none">✕</button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">使用時間</div><div className="font-bold">{detail.run.total_hours.toFixed(1)}h</div></div>
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">レンタル料</div><div className="font-bold">{yen(detail.run.total_lesson_amount)}</div></div>
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">調整</div><div className="font-bold">{yen(detail.run.total_adjustment_amount)}</div></div>
                <div className="bg-orange-50 rounded p-2"><div className="text-[10px] text-orange-600">合計</div><div className="font-bold text-orange-700">{yen(detail.run.total_amount)}</div></div>
              </div>
              <div>
                <h4 className="font-bold text-sm mb-1">レッスン明細 ({detail.lines.length}件)</h4>
                <div className="border rounded overflow-hidden max-h-64 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left">日付</th>
                        <th className="px-2 py-1 text-left">クラス</th>
                        <th className="px-2 py-1 text-right">時間</th>
                        <th className="px-2 py-1 text-right">単価</th>
                        <th className="px-2 py-1 text-right">金額</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map(l => (
                        <tr key={l.id} className="border-t">
                          <td className="px-2 py-1 font-mono">{l.lesson_date}</td>
                          <td className="px-2 py-1">{l.class_name ?? '—'}</td>
                          <td className="px-2 py-1 text-right font-mono">{l.hours.toFixed(1)}h</td>
                          <td className="px-2 py-1 text-right font-mono">{yen(l.hourly_rate)}</td>
                          <td className="px-2 py-1 text-right font-mono">{yen(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                          <button onClick={() => delAdj(a.id)} className="text-slate-400 hover:text-red-600">削除</button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="bg-orange-50 border border-orange-200 rounded p-2 grid grid-cols-1 sm:grid-cols-4 gap-2">
                  <select value={adjForm.type} onChange={e => setAdjForm({ ...adjForm, type: e.target.value })} className="px-2 py-1 border rounded text-xs">
                    {ADJ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input type="number" placeholder="金額(±)" value={adjForm.amount} onChange={e => setAdjForm({ ...adjForm, amount: e.target.value })} className="px-2 py-1 border rounded text-xs" />
                  <input placeholder="説明" value={adjForm.description} onChange={e => setAdjForm({ ...adjForm, description: e.target.value })} className="px-2 py-1 border rounded text-xs" />
                  <button onClick={addAdj} className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded font-semibold">追加</button>
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t">
                <span className="text-xs text-slate-500 self-center">状態:</span>
                <button onClick={() => updateStatus(detail.run.id, 'draft')} className={`px-2 py-1 rounded text-xs ${detail.run.status === 'draft' ? 'bg-slate-200 font-bold' : 'bg-slate-50 hover:bg-slate-100'}`}>下書き</button>
                <button onClick={() => updateStatus(detail.run.id, 'confirmed')} className={`px-2 py-1 rounded text-xs ${detail.run.status === 'confirmed' ? 'bg-blue-200 font-bold' : 'bg-slate-50 hover:bg-blue-100'}`}>確定</button>
                <button onClick={() => updateStatus(detail.run.id, 'paid')} className={`px-2 py-1 rounded text-xs ${detail.run.status === 'paid' ? 'bg-green-200 font-bold' : 'bg-slate-50 hover:bg-green-100'}`}>振込済</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
