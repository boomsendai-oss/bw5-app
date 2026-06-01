'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

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
function yen(n: number): string { return `¥${Number(n).toLocaleString('ja-JP')}`; }

export default function PayrollPage() {
  const [ym, setYm] = useState(prevYM());
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [adjForm, setAdjForm] = useState<{ type: string; amount: string; description: string }>({ type: 'event_bonus', amount: '', description: '' });

  // プレビューURL: アップ済みならDriveの埋め込みプレビュー(高速・キャッシュ済)、未アップはサーバー生成
  const previewUrl = (r: PayrollRun): string => {
    if (r.drive_file_id) {
      // Driveの直接プレビュー(Googleがキャッシュ配信するため即表示)
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
    if (!confirm(`${ym} の給与を計算します。draft状態のデータは上書きされます。よろしいですか?`)) return;
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
      await load(ym);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
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
    if (!confirm("Driveの明細PDFを削除しますか?")) return;
    setRowBusy(s => ({ ...s, [runId]: "del" }));
    // 楽観的: 配布済バッジを即消す
    const prev = runs;
    setRuns(rs => rs.map(r => r.id === runId ? { ...r, drive_file_id: null, payslip_uploaded_at: null } : r));
    try {
      const res = await fetch(`/api/staff/payroll/${runId}/payslip`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      setRuns(prev); // ロールバック
      setErr(`削除失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
      await load(ym);
    }
  };

  const uploadAll = async () => {
    if (!confirm(`${runs.length}名分の明細をDriveへアップロードします。よろしいですか?`)) return;
    setBusy(true);
    let ok = 0, ng = 0;
    for (const r of runs) {
      const success = await uploadOne(r.id);
      success ? ok++ : ng++;
    }
    setBusy(false);
    await load(ym);
    alert(`アップロード完了: 成功 ${ok} / 失敗 ${ng}`);
  };

  const confirmAll = async () => {
    const drafts = runs.filter(r => r.status === 'draft');
    if (drafts.length === 0) { alert('確定対象(下書き)がありません'); return; }
    if (!confirm(`下書きの${drafts.length}名を「確定」にします。よろしいですか?`)) return;
    setBusy(true);
    setErr('');
    const draftIds = new Set(drafts.map(d => d.id));
    const prev = runs;
    // 楽観的: 下書き全員を即 confirmed に
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
      // 失敗分だけ元の状態に戻す
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
    const res = await fetch(`/api/staff/payroll/${detail.run.id}/adjustments`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adjustment_type: adjForm.type,
        amount,
        description: adjForm.description.trim(),
      }),
    });
    if (!res.ok) { alert(`エラー: ${await res.text()}`); return; }
    setAdjForm({ type: 'event_bonus', amount: '', description: '' });
    await openDetail(detail.run.id);
    await load(ym);
  };

  const deleteAdjustment = async (adjId: number) => {
    if (!detail || !confirm('この調整項目を削除しますか?')) return;
    await fetch(`/api/staff/payroll/${detail.run.id}/adjustments?adj_id=${adjId}`, { method: 'DELETE', credentials: 'include' });
    await openDetail(detail.run.id);
    await load(ym);
  };

  const updateStatus = async (runId: number, status: string) => {
    const res = await fetch(`/api/staff/payroll/${runId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      if (detail?.run.id === runId) await openDetail(runId);
      await load(ym);
    }
  };

  // 楽観的ステータス変更(カード用): 即画面反映 → 裏でPATCH → 失敗ならロールバック
  const changeStatus = async (runId: number, next: string) => {
    const prev = runs;
    setRowBusy(s => ({ ...s, [runId]: 'status' }));
    setRuns(rs => rs.map(r => r.id === runId ? { ...r, status: next } : r)); // 楽観的
    try {
      const res = await fetch(`/api/staff/payroll/${runId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) {
      setRuns(prev); // ロールバック
      setErr(`状態変更失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRowBusy(s => { const n = { ...s }; delete n[runId]; return n; });
    }
  };

  const grandTotal = runs.reduce((s, r) => s + r.total_amount, 0);

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader
        title="💰 月次給与計算"
        description="レッスン実績から給与計算 → 調整項目追加 → 確定 → 振込"
        rightExtra={
          <input
            type="month"
            value={ym}
            onChange={e => setYm(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded text-sm"
          />
        }
      />

      <div className="max-w-6xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}

        <div className="bg-white rounded-lg border border-neutral-200 p-3 mb-3 flex items-center justify-between flex-wrap gap-2">
          <div className="text-sm">
            <span className="text-slate-500">対象月:</span> <span className="font-bold text-orange-700">{ym}</span>
            <span className="ml-3 text-slate-500">対象者:</span> <span className="font-bold">{runs.length}人</span>
            <span className="ml-3 text-slate-500">合計:</span> <span className="font-bold text-orange-700">{yen(grandTotal)}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={calculate} disabled={busy}
              className="px-3 py-1.5 rounded bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition">
              {busy ? '⏳ 処理中…' : '🔄 計算実行'}
            </button>
            <a href={`/api/staff/bank-transfer/payroll?year_month=${ym}`} download
              className="px-3 py-1.5 rounded bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold">
              🏦 振込CSV
            </a>
            <button onClick={uploadAll} disabled={busy || runs.length === 0}
              className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition">
              {busy ? '⏳ 処理中…' : '⬆ 全員アップ'}
            </button>
            <button onClick={confirmAll} disabled={busy || runs.length === 0}
              className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold disabled:opacity-50 active:scale-95 transition">
              {busy ? '⏳ 処理中…' : '✓ 全員確定'}
            </button>
          </div>
        </div>

        {loading && <p className="text-slate-500 text-sm">読込中...</p>}

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
                    <span className="font-bold text-base">{r.instructor_name}{r.status === 'confirmed' && ' ✨'}</span>
                    {r.salary_type === 'monthly_fixed' && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">固定給</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      r.status === 'paid' ? 'bg-green-100 text-green-700' :
                      r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {r.status === 'paid' ? '振込済' : r.status === 'confirmed' ? '確定' : '下書き'}
                    </span>
                    {r.payslip_uploaded_at && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">配布済</span>
                    )}
                  </div>
                </div>

                {/* 合計金額 */}
                <div className="text-2xl font-extrabold text-orange-700 mt-1">{yen(r.total_amount)}</div>

                {/* 内訳 */}
                <div className="text-xs text-slate-500 mt-0.5">
                  レッスン{yen(r.total_lesson_amount)}・交通{yen(r.total_transit_amount)}・調整{r.total_adjustment_amount !== 0 ? yen(r.total_adjustment_amount) : '—'}
                </div>

                {/* ボタン */}
                <div className="flex gap-2 mt-3">
                  <a href={previewUrl(r)} target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-center border border-blue-200 text-blue-600 bg-blue-50 py-2.5 rounded-lg text-sm active:scale-95 transition">
                    👁 プレビュー
                  </a>
                  <button onClick={() => uploadOne(r.id).then(() => load(ym))} disabled={!!rowBusy[r.id]}
                    className="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 active:scale-95 transition">
                    {rowBusy[r.id] === 'up' ? '⏳ アップ中…' : r.drive_file_id ? '⬆ 再アップ' : '⬆ アップ'}
                  </button>
                  {r.drive_file_id && (
                    <button onClick={() => deleteOne(r.id)} disabled={!!rowBusy[r.id]}
                      className="basis-12 shrink-0 border border-red-200 text-red-600 bg-red-50 py-2.5 rounded-lg disabled:opacity-50 active:scale-95 transition">
                      {rowBusy[r.id] === 'del' ? '⏳' : '🗑'}
                    </button>
                  )}
                </div>

                {/* 状態変更 */}
                {r.status === 'draft' && (
                  <button onClick={() => changeStatus(r.id, 'confirmed')} disabled={!!rowBusy[r.id]}
                    className="mt-2 w-full py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50 active:scale-95 transition">
                    ✓ 確定する
                  </button>
                )}
                {r.status === 'confirmed' && (
                  <button onClick={() => changeStatus(r.id, 'draft')} disabled={!!rowBusy[r.id]}
                    className="mt-2 w-full py-2 rounded-lg border border-slate-300 text-slate-600 text-xs disabled:opacity-50 active:scale-95 transition">
                    下書きに戻す
                  </button>
                )}

                {/* 詳細リンク */}
                <div className="text-right mt-1.5">
                  <button onClick={() => openDetail(r.id)} className="text-xs text-slate-400 hover:text-slate-600">
                    詳細を見る ›
                  </button>
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

        {/* PC: 既存テーブル (現状維持) */}
        {runs.length > 0 && (
          <div className="hidden sm:block bg-white rounded-lg border border-neutral-200 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left whitespace-nowrap">インストラクター</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">レッスン</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">交通費</th>
                  <th className="px-3 py-2 text-right whitespace-nowrap">調整</th>
                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">合計</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">状態</th>
                  <th className="px-3 py-2 text-center whitespace-nowrap">操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} className="border-b hover:bg-orange-50/50 cursor-pointer" onClick={() => openDetail(r.id)}>
                    <td className="px-3 py-2 font-semibold whitespace-nowrap">
                      {r.instructor_name}
                      {r.salary_type === 'monthly_fixed' && <span className="ml-1 text-[9px] px-1 bg-purple-100 text-purple-700 rounded">固定給</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{yen(r.total_lesson_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{yen(r.total_transit_amount)}</td>
                    <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{r.total_adjustment_amount !== 0 ? yen(r.total_adjustment_amount) : '—'}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-orange-700 whitespace-nowrap">{yen(r.total_amount)}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        r.status === 'paid' ? 'bg-green-100 text-green-700' :
                        r.status === 'confirmed' ? 'bg-blue-100 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {r.status === 'paid' ? '振込済' : r.status === 'confirmed' ? '確定' : '下書き'}
                      </span>
                      {r.payslip_uploaded_at && <span className="ml-1 text-[9px] px-1 bg-emerald-100 text-emerald-700 rounded">配布済</span>}
                    </td>
                    <td className="px-3 py-2 text-center text-xs whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <a href={previewUrl(r)} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:underline mr-2" title="PDFプレビュー">👁</a>
                      <button onClick={() => uploadOne(r.id).then(() => load(ym))} disabled={!!rowBusy[r.id]}
                        className="text-emerald-700 hover:underline mr-2 disabled:opacity-40 active:scale-95 transition inline-block">
                        {rowBusy[r.id] === "up" ? "アップ中…" : r.drive_file_id ? "再アップ" : "⬆アップ"}
                      </button>
                      {r.drive_file_id && (
                        <>
                          {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" className="text-slate-600 hover:underline mr-2" title="Driveで開く">📁</a>}
                          <button onClick={() => deleteOne(r.id)} disabled={!!rowBusy[r.id]}
                            className="text-red-600 hover:underline disabled:opacity-40 active:scale-95 transition inline-block" title="削除">{rowBusy[r.id] === "del" ? "削除中…" : "🗑"}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 border-t font-bold">
                <tr>
                  <td className="px-3 py-2 whitespace-nowrap">合計</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{yen(runs.reduce((s, r) => s + r.total_lesson_amount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{yen(runs.reduce((s, r) => s + r.total_transit_amount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono whitespace-nowrap">{yen(runs.reduce((s, r) => s + r.total_adjustment_amount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono text-orange-700 whitespace-nowrap">{yen(grandTotal)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {runs[0]?.payment_date && (
          <p className="text-xs text-slate-500 mt-2">📅 振込予定日: {runs[0].payment_date}</p>
        )}
      </div>

      {/* 詳細パネル */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-3xl rounded-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold">
                {detail.run.instructor_name} <span className="text-slate-400 text-sm">/ {detail.run.year_month}</span>
              </h3>
              <button onClick={() => setDetail(null)} className="text-2xl text-slate-400 hover:text-slate-700 leading-none">✕</button>
            </div>

            <div className="p-4 space-y-4">
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
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-2 py-1 text-left">日付</th>
                        <th className="px-2 py-1 text-left">クラス</th>
                        <th className="px-2 py-1 text-left">スタジオ</th>
                        <th className="px-2 py-1 text-right">単価</th>
                        <th className="px-2 py-1 text-right">交通費</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.lines.map(l => (
                        <tr key={l.id} className="border-t">
                          <td className="px-2 py-1 font-mono">{l.lesson_date}</td>
                          <td className="px-2 py-1">{l.class_name ?? '—'}</td>
                          <td className="px-2 py-1 text-slate-500">{l.studio_name ?? '—'}</td>
                          <td className="px-2 py-1 text-right font-mono">{yen(l.lesson_rate)}</td>
                          <td className="px-2 py-1 text-right font-mono">{l.transit_fee ? yen(l.transit_fee) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                          <button onClick={() => deleteAdjustment(a.id)} className="text-slate-400 hover:text-red-600 text-xs">削除</button>
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
                  <input placeholder="説明" value={adjForm.description} onChange={e => setAdjForm({ ...adjForm, description: e.target.value })} className="px-2 py-1 border rounded text-xs sm:col-span-1" />
                  <button onClick={addAdjustment} className="px-2 py-1 bg-orange-500 hover:bg-orange-600 text-white text-xs rounded font-semibold">追加</button>
                </div>
              </div>

              {/* ステータス操作 */}
              <div className="flex gap-2 pt-2 border-t">
                <span className="text-xs text-slate-500 self-center">状態:</span>
                <button onClick={() => updateStatus(detail.run.id, 'draft')} className={`px-2 py-1 rounded text-xs ${detail.run.status === 'draft' ? 'bg-slate-200 font-bold' : 'bg-slate-50 hover:bg-slate-100'}`}>下書き</button>
                <button onClick={() => updateStatus(detail.run.id, 'confirmed')} className={`px-2 py-1 rounded text-xs ${detail.run.status === 'confirmed' ? 'bg-blue-200 font-bold' : 'bg-slate-50 hover:bg-blue-100'}`}>確定</button>
                <button onClick={() => updateStatus(detail.run.id, 'paid')} className={`px-2 py-1 rounded text-xs ${detail.run.status === 'paid' ? 'bg-green-200 font-bold' : 'bg-slate-50 hover:bg-green-100'}`}>振込済</button>
                <a href={`/staff/payroll/${detail.run.id}/print`} target="_blank" rel="noopener noreferrer" className="ml-auto px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-semibold">📄 明細書印刷</a>
                {detail.run.payslip_folder_url && (
                  <a href={detail.run.payslip_folder_url} target="_blank" rel="noopener noreferrer" className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-xs">📁 Drive</a>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
