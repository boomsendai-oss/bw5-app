'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

type Preorder = {
  id: number;
  merch_id: number;
  buyer_name: string;
  email: string | null;
  phone: string | null;
  note: string | null;
  status: string | null;
  created_at: string;
  confirmation_email_sent_at: string | null;
  payment_link_sent_at: string | null;
  payment_paid_at: string | null;
  merch_name: string | null;
  price: number | null;
};

export default function VideoPreordersPage() {
  const [preorders, setPreorders] = useState<Preorder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'active' | 'duplicate' | 'unsent' | 'sent'>('all');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/video-preorders', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPreorders(data.preorders || []);
    } catch (e) {
      setMessage(`読み込み失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return preorders.filter(p => {
      // フィルタ
      if (filter === 'active' && p.status === 'duplicate') return false;
      if (filter === 'duplicate' && p.status !== 'duplicate') return false;
      if (filter === 'unsent' && (p.confirmation_email_sent_at || p.status === 'duplicate')) return false;
      if (filter === 'sent' && !p.confirmation_email_sent_at) return false;
      // 検索
      if (qLower) {
        const hay = `${p.buyer_name} ${p.email ?? ''} ${p.phone ?? ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [preorders, filter, q]);

  const toggleSelect = (id: number) => {
    const s = new Set(selected);
    if (s.has(id)) s.delete(id); else s.add(id);
    setSelected(s);
  };

  const selectAllVisible = () => {
    const s = new Set(selected);
    for (const p of filtered) {
      // duplicate/送信済はチェック対象外
      if (p.status === 'duplicate') continue;
      if (p.confirmation_email_sent_at) continue;
      if (!p.email) continue;
      s.add(p.id);
    }
    setSelected(s);
  };

  const clearSelection = () => setSelected(new Set());

  const sendConfirmation = async (ids: number[]) => {
    if (ids.length === 0) return;
    if (!window.confirm(`${ids.length}件に確認メールを送信します。よろしいですか?`)) return;
    setBusy(true);
    setMessage(`${ids.length}件 送信中...`);
    try {
      const res = await fetch('/api/staff/video-preorders/send-confirmation', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage(`✅ 送信完了: 成功 ${data.sent} / スキップ ${data.skipped} / 失敗 ${data.failed}`);
      setSelected(new Set());
      await load();
    } catch (e) {
      setMessage(`❌ 送信失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const markStatus = async (id: number, status: 'active' | 'duplicate' | 'cancelled') => {
    setBusy(true);
    try {
      const res = await fetch(`/api/staff/video-preorders/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setMessage(`✅ #${id} を ${status} に変更`);
      await load();
    } catch (e) {
      setMessage(`❌ 更新失敗: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const fmtDateTime = (iso: string | null) => {
    if (!iso) return '-';
    try {
      const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
      return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
  };

  const counts = useMemo(() => ({
    total: preorders.length,
    active: preorders.filter(p => p.status !== 'duplicate' && p.status !== 'cancelled').length,
    duplicate: preorders.filter(p => p.status === 'duplicate').length,
    sent: preorders.filter(p => p.confirmation_email_sent_at).length,
    unsent: preorders.filter(p => !p.confirmation_email_sent_at && p.status !== 'duplicate').length,
  }), [preorders]);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl sm:text-2xl font-bold text-orange-700">📹 映像予約 管理</h1>
        <div className="flex gap-2 text-xs sm:text-sm">
          <a href="/staff/dashboard" className="text-orange-600 hover:underline">← ダッシュボード</a>
        </div>
      </div>

      {/* サマリ */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-4">
        {[
          { k: 'total', label: '全体', v: counts.total, color: 'bg-slate-100 text-slate-700' },
          { k: 'active', label: '有効', v: counts.active, color: 'bg-emerald-100 text-emerald-800' },
          { k: 'duplicate', label: '重複', v: counts.duplicate, color: 'bg-red-100 text-red-800' },
          { k: 'sent', label: '確認メール送信済', v: counts.sent, color: 'bg-blue-100 text-blue-800' },
          { k: 'unsent', label: '未送信', v: counts.unsent, color: 'bg-amber-100 text-amber-800' },
        ].map(s => (
          <div key={s.k} className={`${s.color} rounded-lg px-3 py-2`}>
            <div className="text-[10px] sm:text-xs">{s.label}</div>
            <div className="text-lg sm:text-xl font-bold">{s.v}</div>
          </div>
        ))}
      </div>

      {/* フィルタ + 検索 */}
      <div className="flex flex-wrap gap-2 mb-3">
        {([
          ['all', '全て'],
          ['active', '有効のみ'],
          ['unsent', '未送信のみ'],
          ['sent', '送信済のみ'],
          ['duplicate', '重複のみ'],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-3 py-1 rounded-full text-xs sm:text-sm ${filter === k ? 'bg-orange-500 text-white' : 'bg-white border border-slate-200 text-slate-700'}`}
          >
            {label}
          </button>
        ))}
        <input
          type="text"
          placeholder="名前/メアド/電話で検索"
          value={q}
          onChange={e => setQ(e.target.value)}
          className="px-3 py-1 rounded border border-slate-200 text-sm flex-1 min-w-[180px]"
        />
      </div>

      {/* 一括操作 */}
      <div className="mb-3 flex flex-wrap gap-2 items-center">
        <button
          onClick={selectAllVisible}
          disabled={busy}
          className="px-3 py-1.5 rounded bg-slate-200 hover:bg-slate-300 text-xs sm:text-sm"
        >
          表示中の未送信を全選択
        </button>
        <button
          onClick={clearSelection}
          disabled={busy || selected.size === 0}
          className="px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs sm:text-sm disabled:opacity-50"
        >
          選択解除
        </button>
        <span className="text-xs sm:text-sm text-slate-600">選択中: {selected.size}件</span>
        <button
          onClick={() => sendConfirmation(Array.from(selected))}
          disabled={busy || selected.size === 0}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold disabled:opacity-50"
        >
          ✉️ 選択中{selected.size}件に確認メール送信
        </button>
      </div>

      {message && (
        <div className="mb-3 p-3 rounded bg-amber-50 border border-amber-200 text-amber-900 text-sm">{message}</div>
      )}

      {/* リスト */}
      {loading ? (
        <p className="text-slate-500">読み込み中...</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-slate-200">
          <table className="w-full text-xs sm:text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="px-2 py-2 text-left">選</th>
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">状態</th>
                <th className="px-2 py-2 text-left">お名前</th>
                <th className="px-2 py-2 text-left">メール</th>
                <th className="px-2 py-2 text-left">電話</th>
                <th className="px-2 py-2 text-left">予約日</th>
                <th className="px-2 py-2 text-left">確認メール</th>
                <th className="px-2 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const isDup = p.status === 'duplicate';
                const isSent = !!p.confirmation_email_sent_at;
                const canSelect = !isDup && !isSent && !!p.email;
                return (
                  <tr key={p.id} className={`border-t border-slate-100 ${isDup ? 'opacity-50' : ''}`}>
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        disabled={!canSelect}
                      />
                    </td>
                    <td className="px-2 py-2">{p.id}</td>
                    <td className="px-2 py-2">
                      {isDup
                        ? <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 text-[10px]">重複</span>
                        : p.status === 'cancelled'
                        ? <span className="px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 text-[10px]">取消</span>
                        : <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px]">有効</span>}
                    </td>
                    <td className="px-2 py-2 font-medium">{p.buyer_name}</td>
                    <td className="px-2 py-2">
                      {p.email || <span className="text-slate-400">-</span>}
                    </td>
                    <td className="px-2 py-2">{p.phone || '-'}</td>
                    <td className="px-2 py-2">{fmtDateTime(p.created_at)}</td>
                    <td className="px-2 py-2">
                      {isSent
                        ? <span className="text-blue-700 text-[11px]">📧 {fmtDateTime(p.confirmation_email_sent_at)}</span>
                        : <span className="text-amber-700 text-[11px]">未送信</span>}
                    </td>
                    <td className="px-2 py-2 whitespace-nowrap">
                      {isDup
                        ? <button onClick={() => markStatus(p.id, 'active')} disabled={busy} className="px-2 py-0.5 text-[10px] rounded bg-slate-200 hover:bg-slate-300">有効に戻す</button>
                        : <button onClick={() => markStatus(p.id, 'duplicate')} disabled={busy} className="px-2 py-0.5 text-[10px] rounded bg-red-100 hover:bg-red-200 text-red-700">重複マーク</button>}
                      {p.email && (
                        <button
                          onClick={() => sendConfirmation([p.id])}
                          disabled={busy || isDup}
                          className="ml-1 px-2 py-0.5 text-[10px] rounded bg-blue-100 hover:bg-blue-200 text-blue-700 disabled:opacity-50"
                        >
                          {isSent ? '再送' : '送信'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-400">該当なし</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
