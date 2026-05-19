'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Master = { id: number; class_name: string; default_day_of_week: number; default_start_time: string; default_end_time: string; studio_name: string | null };
type Instance = { id: number; date: string; start_time: string; end_time: string; status: string; class_name: string | null; studio_name: string | null };
type CancelReq = { id: number; lesson_date: string; reason: string; status: string };
type Data = { year_month: string; masters: Master[]; instances: Instance[]; cancel_requests: CancelReq[] };

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export default function InstructorLessonsPage() {
  const router = useRouter();
  const [ym, setYm] = useState(currentYM());
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch(`/api/instructor/lessons?year_month=${ym}`, { credentials: 'include' })
      .then(async r => {
        if (r.status === 401) { router.push('/instructor'); return null; }
        return r.json();
      })
      .then(d => { if (alive && d) { setData(d); setLoading(false); } });
    return () => { alive = false; };
  }, [ym, router]);

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/instructor/dashboard" className="text-sm text-slate-500 hover:text-orange-600">← 戻る</Link>
          <h1 className="font-bold text-orange-600">📅 担当レッスン</h1>
          <input type="month" value={ym} onChange={e => setYm(e.target.value)} className="px-2 py-1 border rounded text-sm" />
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-4 space-y-4">
        {loading && <p className="text-slate-500 text-sm">読込中...</p>}
        {data && (
          <>
            <section>
              <h2 className="font-bold text-sm mb-2">📋 通常担当クラス (週次)</h2>
              <div className="bg-white border rounded-lg overflow-hidden">
                {data.masters.length === 0 ? (
                  <p className="p-4 text-sm text-slate-500">担当クラスがマスタに登録されていません</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr><th className="px-3 py-2 text-left">曜日</th><th className="px-3 py-2 text-left">時間</th><th className="px-3 py-2 text-left">クラス</th><th className="px-3 py-2 text-left">スタジオ</th></tr>
                    </thead>
                    <tbody>
                      {data.masters.map(m => (
                        <tr key={m.id} className="border-b">
                          <td className="px-3 py-2 font-bold">{DOW[m.default_day_of_week]}</td>
                          <td className="px-3 py-2 font-mono">{m.default_start_time?.substring(0, 5)} - {m.default_end_time?.substring(0, 5)}</td>
                          <td className="px-3 py-2">{m.class_name}</td>
                          <td className="px-3 py-2 text-slate-500">{m.studio_name ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {data.instances.length > 0 && (
              <section>
                <h2 className="font-bold text-sm mb-2">📌 {data.year_month} の実開催</h2>
                <div className="bg-white border rounded-lg overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b">
                      <tr><th className="px-3 py-2 text-left">日付</th><th className="px-3 py-2 text-left">時間</th><th className="px-3 py-2 text-left">クラス</th><th className="px-3 py-2 text-center">状態</th></tr>
                    </thead>
                    <tbody>
                      {data.instances.map(i => (
                        <tr key={i.id} className="border-b">
                          <td className="px-3 py-2 font-mono">{i.date}</td>
                          <td className="px-3 py-2 font-mono">{i.start_time?.substring(0, 5)}</td>
                          <td className="px-3 py-2">{i.class_name ?? '—'}</td>
                          <td className="px-3 py-2 text-center text-xs">
                            <span className={`px-1.5 py-0.5 rounded ${i.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                              {i.status === 'cancelled' ? '休講' : '開催'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {data.cancel_requests.length > 0 && (
              <section>
                <h2 className="font-bold text-sm mb-2">🚫 休講申請履歴 (当月)</h2>
                <div className="space-y-1">
                  {data.cancel_requests.map(c => (
                    <div key={c.id} className="bg-white border rounded p-2 text-xs flex justify-between">
                      <div><span className="font-mono">{c.lesson_date}</span><span className="ml-2">{c.reason}</span></div>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${c.status === 'approved' ? 'bg-green-100 text-green-700' : c.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                        {c.status === 'approved' ? '承認済' : c.status === 'rejected' ? '却下' : '審査中'}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <Link href="/instructor/cancel" className="block text-center py-3 bg-red-50 border border-red-200 text-red-700 rounded-lg font-semibold">🚫 休講申請する</Link>
          </>
        )}
      </div>
    </main>
  );
}
