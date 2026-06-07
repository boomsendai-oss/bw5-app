'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Edit3, X } from 'lucide-react';
import { TabHeader, Toast, useToast } from '../_components/AdminShared';
import type { VideoOrder } from '../_components/types';

export default function AdminVideoPage() {
  const { toast, notify, clearToast } = useToast();
  const [orders, setOrders] = useState<VideoOrder[]>([]);
  const [price, setPrice] = useState('');
  const [editingPrice, setEditingPrice] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/video-orders');
    const data = await res.json();
    setOrders(data.orders || []);
    setPrice(data.price || '2500');
  }, []);

  useEffect(() => { load(); }, [load]);

  const savePrice = async () => {
    await fetch('/api/settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_price: price }),
    });
    setEditingPrice(false);
    notify('価格を更新しました');
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'paid': return '#22c55e';
      case 'pending': return '#f4a261';
      case 'cancelled': return '#ef4444';
      default: return 'var(--text-secondary)';
    }
  };

  return (
    <div>
      {toast && <Toast message={toast} onClose={clearToast} />}
      <TabHeader title="映像管理" />

      <div className="card p-4 mb-6">
        <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-secondary)' }}>映像販売価格</h3>
        <div className="flex items-center gap-3">
          {editingPrice ? (
            <>
              <span className="text-lg">&yen;</span>
              <input className="admin-input w-32" type="number" value={price} onChange={e => setPrice(e.target.value)} />
              <button onClick={savePrice} className="btn-primary text-sm px-3 py-1.5"><Save className="w-3 h-3" /></button>
              <button onClick={() => setEditingPrice(false)} className="btn-secondary text-sm px-3 py-1.5"><X className="w-3 h-3" /></button>
            </>
          ) : (
            <>
              <span className="text-2xl font-bold">&yen;{Number(price).toLocaleString()}</span>
              <button onClick={() => setEditingPrice(true)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-secondary)' }}><Edit3 className="w-4 h-4" /></button>
            </>
          )}
        </div>
      </div>

      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-secondary)' }}>映像注文一覧 ({orders.length}件)</h3>
      <div className="card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr><th>ID</th><th>購入者</th><th>メール</th><th>支払方法</th><th>ステータス</th><th>日時</th></tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o.id}>
                <td className="font-mono">#{o.id}</td>
                <td>{o.buyer_name}</td>
                <td style={{ color: 'var(--text-secondary)' }}>{o.email}</td>
                <td>{o.payment_method}</td>
                <td>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ color: statusColor(o.status), background: `${statusColor(o.status)}20` }}>
                    {o.status === 'paid' ? '支払済' : o.status === 'pending' ? '未払い' : o.status}
                  </span>
                </td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{o.created_at}</td>
              </tr>
            ))}
            {orders.length === 0 && <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>注文がありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
