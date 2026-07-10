'use client';

import { useEffect, useState, use } from 'react';
import { yen } from '@/lib/utils';

type Run = {
  id: number; year_month: string; instructor_name: string;
  total_lesson_amount: number; total_transit_amount: number;
  total_adjustment_amount: number; total_amount: number;
  payment_date: string | null; status: string;
  bank_name: string | null; bank_branch: string | null;
  bank_account_type: string | null; bank_account_number: string | null;
  bank_account_holder: string | null;
};
type Line = { id: number; lesson_date: string; class_name: string | null; duration_minutes: number | null; studio_name: string | null; lesson_rate: number; transit_fee: number };
type Adj = { id: number; adjustment_type: string; amount: number; description: string };
type Detail = { run: Run; lines: Line[]; adjustments: Adj[] };

const ADJ_LABELS: Record<string, string> = {
  event_bonus: 'イベント手当', substitute_fee: '代講料', special_lesson: '特別レッスン',
  deduction: '減算', other: 'その他',
};

export default function PayrollPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    fetch(`/api/staff/payroll/${id}`, { credentials: 'include' })
      .then(async r => r.ok ? r.json() : null)
      .then(d => { if (d) setDetail(d); });
  }, [id]);

  if (!detail) return <p className="p-8">読込中...</p>;
  const r = detail.run;
  return (
    <main className="bg-white text-black min-h-screen p-8 print:p-0">
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          .no-print { display: none !important; }
        }
        .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
      `}</style>
      <div className="no-print mb-4 print:hidden">
        <button onClick={() => window.print()} className="px-4 py-2 bg-brand-500 text-white rounded font-semibold">🖨️ 印刷 / PDF保存 (Cmd+P)</button>
        <p className="text-xs text-slate-500 mt-1">「PDFとして保存」を選ぶとPDF化できます</p>
      </div>

      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-bold text-center border-b-2 border-brand-500 pb-3">給与明細書</h1>
        <p className="text-center text-sm mt-1">{r.year_month} 分</p>

        <div className="grid-2 mt-6 text-sm">
          <div>
            <div className="text-xs text-slate-500">支払先</div>
            <div className="font-bold text-lg">{r.instructor_name} 様</div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">振込予定日</div>
            <div className="font-bold">{r.payment_date ?? '—'}</div>
          </div>
        </div>

        <div className="mt-6 p-4 border-2 border-brand-500 rounded">
          <div className="flex justify-between items-baseline">
            <span className="text-sm">お支払い合計</span>
            <span className="text-3xl font-bold text-brand-700">{yen(r.total_amount)}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 mt-3 text-xs">
            <div><div className="text-slate-500">レッスン</div><div className="font-bold">{yen(r.total_lesson_amount)}</div></div>
            <div><div className="text-slate-500">交通費</div><div className="font-bold">{yen(r.total_transit_amount)}</div></div>
            <div><div className="text-slate-500">調整</div><div className="font-bold">{yen(r.total_adjustment_amount)}</div></div>
          </div>
        </div>

        {detail.lines.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold mb-2">レッスン明細</h2>
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b">
                  <th className="px-2 py-1 text-left">日付</th>
                  <th className="px-2 py-1 text-left">クラス</th>
                  <th className="px-2 py-1 text-left">スタジオ</th>
                  <th className="px-2 py-1 text-center">時間</th>
                  <th className="px-2 py-1 text-right">単価</th>
                  <th className="px-2 py-1 text-right">交通費</th>
                </tr>
              </thead>
              <tbody>
                {detail.lines.map(l => (
                  <tr key={l.id} className="border-b">
                    <td className="px-2 py-1 font-mono">{l.lesson_date}</td>
                    <td className="px-2 py-1">{l.class_name ?? '—'}</td>
                    <td className="px-2 py-1 text-slate-500">{l.studio_name ?? '—'}</td>
                    <td className="px-2 py-1 text-center">{l.duration_minutes ? `${l.duration_minutes}分` : '—'}</td>
                    <td className="px-2 py-1 text-right font-mono">{yen(l.lesson_rate)}</td>
                    <td className="px-2 py-1 text-right font-mono">{l.transit_fee ? yen(l.transit_fee) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {detail.adjustments.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-bold mb-2">調整項目</h2>
            <table className="w-full text-xs border-collapse">
              <tbody>
                {detail.adjustments.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="px-2 py-1 font-semibold">{ADJ_LABELS[a.adjustment_type] ?? a.adjustment_type}</td>
                    <td className="px-2 py-1">{a.description}</td>
                    <td className={`px-2 py-1 text-right font-mono ${a.amount >= 0 ? 'text-green-700' : 'text-red-700'}`}>{yen(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {(r.bank_name || r.bank_account_number) && (
          <div className="mt-6 p-3 border border-slate-300 rounded text-xs">
            <div className="font-bold mb-1">振込先</div>
            <div>{r.bank_name ?? '—'} {r.bank_branch ?? ''}</div>
            <div>{r.bank_account_type === '2' ? '当座' : '普通'} {r.bank_account_number ?? '—'}</div>
            <div>{r.bank_account_holder ?? r.instructor_name}</div>
          </div>
        )}

        <div className="mt-8 text-xs text-slate-700 leading-relaxed">
          <p>今月もBOOMのレッスンをご担当いただき、誠にありがとうございました。</p>
          <p>来月もどうぞよろしくお願いいたします。</p>
          <p className="mt-3 text-right font-semibold">BOOM 代表 木村慎大郎 (TARO)</p>
        </div>
      </div>
    </main>
  );
}
