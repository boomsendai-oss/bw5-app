'use client';

import { useState, useEffect, useCallback } from 'react';
import { Filter } from 'lucide-react';
import { TabHeader, Toast, useToast } from '../_components/AdminShared';
import type { MerchOrder, VideoOrder } from '../_components/types';

export default function AdminOrdersPage() {
  const { toast, notify, clearToast } = useToast();
  const [merchOrders, setMerchOrders] = useState<MerchOrder[]>([]);
  const [videoOrders, setVideoOrders] = useState<VideoOrder[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all');
  const [orderType, setOrderType] = useState<'all' | 'merch' | 'video'>('all');

  const load = useCallback(async () => {
    const [mRes, vRes] = await Promise.all([
      fetch('/api/merch/order'),
      fetch('/api/video-orders'),
    ]);
    const mData = await mRes.json();
    const vData = await vRes.json();
    setMerchOrders(Array.isArray(mData) ? mData : []);
    setVideoOrders(vData.orders || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateStatus = async (id: number, status: string) => {
    const res = await fetch('/api/merch/order', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) { notify('更新しました'); load(); }
    else { notify('更新に失敗しました'); }
  };

  const updateVideoStatus = async (id: number, status: string) => {
    const res = await fetch('/api/video-orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) { notify('更新しました'); load(); }
    else { notify('更新に失敗しました'); }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'paid': return '#22c55e';
      case 'delivered': return '#0ea5e9';
      case 'pending_cash': return '#f4a261';
      case 'awaiting_payment': return '#eab308';
      case 'pending': return '#f4a261';
      case 'waiting': return '#eab308';
      case 'cancelled': return '#ef4444';
      default: return 'var(--text-secondary)';
    }
  };
  const statusLabel = (status: string) => {
    switch (status) {
      case 'paid': return '支払済';
      case 'delivered': return '配信済';
      case 'pending_cash': return '当日現金';
      case 'awaiting_payment': return '決済待ち';
      case 'pending': return '未払い';
      case 'waiting': return '予約受付中';
      case 'cancelled': return 'キャンセル';
      default: return status;
    }
  };
  const isPaid = (s: string) => s === 'paid' || s === 'delivered';
  const isPending = (s: string) =>
    s === 'pending_cash' || s === 'awaiting_payment' || s === 'pending' || s === 'waiting';

  type CombinedOrder = {
    id: string; rawId: number; type: 'merch' | 'video'; typeLabel: string;
    buyer_name: string; detail: string; payment_method: string;
    status: string; created_at: string;
  };

  const combined: CombinedOrder[] = [
    ...(orderType === 'all' || orderType === 'merch' ? merchOrders.map(o => {
      const variant = [o.color, o.size].filter(Boolean).join(' / ');
      return {
        id: `M-${o.id}`, rawId: o.id, type: 'merch' as const, typeLabel: 'グッズ',
        buyer_name: o.buyer_name,
        detail: `${o.merch_name ?? ''}${variant ? ` (${variant})` : ''}`,
        payment_method: o.payment_method,
        status: o.status, created_at: o.created_at,
      };
    }) : []),
    ...(orderType === 'all' || orderType === 'video' ? videoOrders.map(o => ({
      id: `V-${o.id}`, rawId: o.id, type: 'video' as const, typeLabel: '映像',
      buyer_name: o.buyer_name,
      detail: [o.email, o.phone].filter(Boolean).join(' / '),
      payment_method: o.payment_method,
      status: o.status, created_at: o.created_at,
    })) : []),
  ]
    .filter(o => {
      if (filter === 'all') return true;
      if (filter === 'paid') return isPaid(o.status);
      if (filter === 'pending') return isPending(o.status);
      return true;
    })
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const pmLabel = (pm: string) => {
    if (pm === 'cash_onsite') return '当日現金';
    if (pm === 'online_square') return 'Square決済';
    if (pm === 'online_video') return 'オンライン';
    return pm;
  };
  const totalPending = merchOrders.filter(o => isPending(o.status)).length +
                       videoOrders.filter(o => isPending(o.status)).length;

  return (
    <div>
      {toast && <Toast message={toast} onClose={clearToast} />}
      <TabHeader title="注文管理" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold">{merchOrders.length + videoOrders.length}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>総注文数</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold" style={{ color: '#f4a261' }}>{totalPending}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>未払い</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold">{merchOrders.length}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>グッズ注文</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold">{videoOrders.length}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>映像注文</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1 mr-4">
          <Filter className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>絞り込み:</span>
        </div>
        {(['all', 'pending', 'paid'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="text-xs px-3 py-1 rounded-full transition-colors"
            style={{
              background: filter === f ? 'var(--accent-primary)' : 'var(--bg-card)',
              color: filter === f ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${filter === f ? 'var(--accent-primary)' : 'var(--border-color)'}`,
            }}>
            {f === 'all' ? '全て' : f === 'pending' ? '未払い' : '支払済'}
          </button>
        ))}
        <span className="mx-2" style={{ color: 'var(--border-color)' }}>|</span>
        {(['all', 'merch', 'video'] as const).map(t => (
          <button key={t} onClick={() => setOrderType(t)}
            className="text-xs px-3 py-1 rounded-full transition-colors"
            style={{
              background: orderType === t ? 'var(--accent-primary)' : 'var(--bg-card)',
              color: orderType === t ? 'white' : 'var(--text-secondary)',
              border: `1px solid ${orderType === t ? 'var(--accent-primary)' : 'var(--border-color)'}`,
            }}>
            {t === 'all' ? '全種類' : t === 'merch' ? 'グッズ' : '映像'}
          </button>
        ))}
      </div>

      <div className="card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr><th>注文ID</th><th>種類</th><th>購入者</th><th>詳細</th><th>支払方法</th><th>ステータス</th><th>日時</th><th>操作</th></tr>
          </thead>
          <tbody>
            {combined.map(o => (
              <tr key={o.id}>
                <td className="font-mono text-xs">{o.id}</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                    {o.typeLabel}
                  </span>
                </td>
                <td>{o.buyer_name}</td>
                <td className="text-sm" style={{ color: 'var(--text-secondary)' }}>{o.detail}</td>
                <td className="text-xs">{pmLabel(o.payment_method)}</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ color: statusColor(o.status), background: `${statusColor(o.status)}20` }}>
                    {statusLabel(o.status)}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.created_at}</td>
                <td>
                  {o.type === 'merch' && isPending(o.status) && (
                    <div className="flex gap-1">
                      <button onClick={() => updateStatus(o.rawId, 'paid')} className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ background: '#22c55e' }}>支払済</button>
                      <button onClick={() => updateStatus(o.rawId, 'cancelled')} className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ background: '#ef4444' }}>取消</button>
                    </div>
                  )}
                  {o.type === 'video' && (
                    <div className="flex gap-1 flex-wrap">
                      {isPending(o.status) && (
                        <button onClick={() => updateVideoStatus(o.rawId, 'paid')} className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ background: '#22c55e' }}>支払済</button>
                      )}
                      {o.status === 'paid' && (
                        <button onClick={() => updateVideoStatus(o.rawId, 'delivered')} className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ background: '#0ea5e9' }}>配信済</button>
                      )}
                      {o.status !== 'cancelled' && (
                        <button onClick={() => { if (confirm('この予約をキャンセル扱いにしますか？')) updateVideoStatus(o.rawId, 'cancelled'); }} className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ background: '#ef4444' }}>取消</button>
                      )}
                      {o.status === 'cancelled' && (
                        <button onClick={() => updateVideoStatus(o.rawId, 'waiting')} className="text-xs px-2 py-0.5 rounded font-medium text-white" style={{ background: '#6b7280' }}>復活</button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {combined.length === 0 && <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>注文がありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
