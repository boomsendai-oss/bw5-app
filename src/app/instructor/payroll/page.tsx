'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Run = {
  id: number; year_month: string;
  total_lesson_amount: number; total_transit_amount: number;
  total_adjustment_amount: number; total_amount: number;
  payment_date: string | null; status: string; pdf_url: string | null;
};

type Line = { id: number; lesson_date: string; class_name: string | null; duration_minutes: number | null; studio_name: string | null; lesson_rate: number; transit_fee: number };
type Adj = { id: number; adjustment_type: string; amount: number; description: string };
type Detail = { run: Run; lines: Line[]; adjustments: Adj[] };

function yen(n: number): string { return `¥${Number(n).toLocaleString('ja-JP')}`; }
const ADJ_LABELS: Record<string, string> = {
  event_bonus: 'イベント手当', substitute_fee: '代講料', special_lesson: '特別レッスン',
  deduction: '減算', other: 'その他',
};

export default function InstructorPayrollPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<Run[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/instructor/payroll', { credentials: 'include' }).then(async r => {
      if (r.status === 401) { router.push('/instructor'); return; }
      const d = await r.json();
      setRuns(d.runs ?? []);
      setLoading(false);
    });
  }, [router]);

  const openDetail = async (ym: string) => {
    const res = await fetch(`/api/instructor/payroll?year_month=${ym}`, { credentials: 'include' });
    if (res.ok) setDetail(await res.json());
  };

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/instructor/dashboard" className="text-sm text-slate-500 hover:text-orange-600">← 戻る</Link>
          <h1 className="font-bold text-orange-600">💰 給与明細</h1>
          <span></span>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        {loading && <p className="text-slate-500 text-sm">読込中...</p>}
        {!loading && runs.length === 0 && <p className="text-slate-500 text-sm p-4 bg-white rounded border">まだ確定された明細がありません</p>}
        {runs.length > 0 && (
          <div className="bg-white rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b">
                <tr>
                  <th className="px-3 py-2 text-left">月</th>
                  <th className="px-3 py-2 text-right">合計</th>
                  <th className="px-3 py-2 text-center">振込予定</th>
                  <th className="px-3 py-2 text-center">状態</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id} onClick={() => openDetail(r.year_month)} className="border-b hover:bg-orange-50/50 cursor-pointer">
                    <td className="px-3 py-2 font-semibold">{r.year_month}</td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-orange-700">{yen(r.total_amount)}</td>
                    <td className="px-3 py-2 text-center text-xs font-mono text-slate-500">{r.payment_date}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${r.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {r.status === 'paid' ? '振込済' : '確定'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-orange-600">詳細 →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3" onClick={() => setDetail(null)}>
          <div className="bg-white w-full max-w-2xl rounded-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold">{detail.run.year_month} 給与明細</h3>
              <button onClick={() => setDetail(null)} className="text-2xl text-slate-400 leading-none">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">レッスン</div><div className="font-bold">{yen(detail.run.total_lesson_amount)}</div></div>
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">交通費</div><div className="font-bold">{yen(detail.run.total_transit_amount)}</div></div>
                <div className="bg-slate-50 rounded p-2"><div className="text-[10px] text-slate-500">調整</div><div className="font-bold">{yen(detail.run.total_adjustment_amount)}</div></div>
                <div className="bg-orange-50 rounded p-2"><div className="text-[10px] text-orange-600">合計</div><div className="font-bold text-orange-700">{yen(detail.run.total_amount)}</div></div>
              </div>
              <div className="text-xs text-slate-600">振込予定日: <span className="font-mono font-bold">{detail.run.payment_date}</span></div>
              <div>
                <h4 className="font-bold text-sm mb-1">レッスン明細</h4>
                <div className="border rounded overflow-hidden max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr><th className="px-2 py-1 text-left">日付</th><th className="px-2 py-1 text-left">クラス</th><th className="px-2 py-1 text-left">スタジオ</th><th className="px-2 py-1 text-right">単価</th><th className="px-2 py-1 text-right">交通費</th></tr>
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
              {detail.adjustments.length > 0 && (
                <div>
                  <h4 className="font-bold text-sm mb-1">調整項目</h4>
                  {detail.adjustments.map(a => (
                    <div key={a.id} className="flex justify-between text-xs bg-slate-50 rounded px-2 py-1 mb-1">
                      <div><span className="font-semibold">{ADJ_LABELS[a.adjustment_type] ?? a.adjustment_type}</span><span className="ml-2 text-slate-600">{a.description}</span></div>
                      <span className={`font-mono font-bold ${a.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>{yen(a.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
              {detail.run.pdf_url && (
                <a href={detail.run.pdf_url} target="_blank" rel="noopener noreferrer" className="block text-center py-2 bg-blue-500 text-white rounded font-semibold text-sm">📄 PDF明細を開く</a>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
