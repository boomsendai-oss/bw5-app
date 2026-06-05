'use client';

import { useCallback, useEffect, useState } from 'react';
import StaffPageHeader from '@/components/StaffPageHeader';

type CancelReq = {
  id: number;
  instructor_id: number;
  instructor_name: string;
  instructor_email: string | null;
  lesson_date: string;
  master_id: number | null;
  instance_id: number | null;
  reason: string;
  substitute_instructor_id: number | null;
  substitute_name: string | null;
  status: 'pending' | 'approved' | 'rejected';
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export default function CancelRequestsPage() {
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [items, setItems] = useState<CancelReq[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetch(`/api/staff/cancel-requests?status=${tab}`, { credentials: 'include' });
      if (res.status === 401) { window.location.href = '/staff/events/login?next=/staff/cancel-requests'; return; }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = await res.json();
      setItems(d.requests ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: number, status: 'approved' | 'rejected', applyToInstance: boolean) => {
    const label = status === 'approved' ? '承認' : '却下';
    if (!confirm(`この休講申請を${label}しますか?${applyToInstance && status === 'approved' ? '\n(該当レッスンを自動で「休講」化します)' : ''}`)) return;

    // 楽観的更新: 該当 item の status を即時反映
    const nowIso = new Date().toISOString();
    setItems(prev => prev.map(it =>
      it.id === id
        ? { ...it, status, reviewed_by: 'TARO', reviewed_at: nowIso }
        : it
    ));

    try {
      const res = await fetch(`/api/staff/cancel-requests/${id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, apply: applyToInstance, reviewer: 'TARO' }),
      });
      if (!res.ok) throw new Error(await res.text());
      load(); // fire-and-forget で再同期
    } catch (e) {
      setErr(`失敗: ${e instanceof Error ? e.message : String(e)}`);
      load(); // 強制再同期でロールバック
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50 text-neutral-900">
      <StaffPageHeader title="🚫 休講申請" description="インストラクターからの休講申請を確認・承認" />

      <div className="max-w-5xl mx-auto p-3 sm:p-4">
        {err && <div className="mb-3 p-3 rounded bg-red-50 border border-red-200 text-red-800 text-sm">{err}</div>}

        <div className="flex gap-1 mb-3 border-b">
          {[
            { k: 'pending' as const, label: '⏳ 審査中' },
            { k: 'all' as const, label: '📋 すべて' },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-t border-b-2 ${tab === t.k ? 'border-orange-500 text-orange-700 bg-orange-50' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-slate-500 text-sm">読込中...</p>}
        {!loading && items.length === 0 && <p className="text-slate-500 text-sm p-4 bg-white rounded border">申請なし</p>}

        {items.length > 0 && (
          <div className="space-y-2">
            {items.map(req => (
              <div key={req.id} className={`bg-white border rounded-lg p-3 ${req.status === 'pending' ? 'border-amber-300' : req.status === 'approved' ? 'border-green-300' : 'border-red-300'}`}>
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{req.instructor_name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${req.status === 'pending' ? 'bg-amber-100 text-amber-700' : req.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {req.status === 'pending' ? '審査中' : req.status === 'approved' ? '承認済' : '却下'}
                    </span>
                  </div>
                  <span className="font-mono text-sm">{req.lesson_date}</span>
                </div>
                <div className="mt-2 text-sm bg-slate-50 rounded p-2">
                  <div><span className="text-xs text-slate-500">理由: </span>{req.reason}</div>
                  {req.substitute_name && <div className="mt-1 text-xs"><span className="text-slate-500">希望代講: </span>{req.substitute_name}</div>}
                </div>
                <div className="mt-1 text-[10px] text-slate-400">申請日時: {new Date(req.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</div>
                {req.status === 'pending' && (
                  <div className="mt-2 flex gap-2 flex-wrap">
                    <button onClick={() => decide(req.id, 'approved', true)} className="px-3 py-1.5 bg-green-500 hover:bg-green-600 text-white text-xs rounded font-semibold">
                      ✅ 承認 (レッスン自動休講化)
                    </button>
                    <button onClick={() => decide(req.id, 'approved', false)} className="px-3 py-1.5 bg-green-100 hover:bg-green-200 text-green-700 text-xs rounded font-semibold">
                      ✅ 承認のみ (休講化は手動で)
                    </button>
                    <button onClick={() => decide(req.id, 'rejected', false)} className="px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-700 text-xs rounded">
                      ❌ 却下
                    </button>
                  </div>
                )}
                {req.status !== 'pending' && req.reviewed_at && (
                  <div className="mt-1 text-[10px] text-slate-500">
                    {req.reviewed_by ?? 'staff'} が {new Date(req.reviewed_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} に処理
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
