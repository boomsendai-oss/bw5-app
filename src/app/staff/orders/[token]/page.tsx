'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { ShoppingBag, RefreshCw, Trophy, Check } from 'lucide-react';

interface Order {
  id: number;
  merch_id: number;
  merch_name: string;
  price: number;
  color: string;
  size: string;
  buyer_name: string;
  email: string;
  quantity: number;
  payment_method: string;
  status: string;
  created_at: string;
}
interface Winner {
  id: number;
  fingerprint: string;
  prize_name: string;
  winner_name?: string;
  created_at: string;
}
interface Summary {
  total_orders: number;
  pending: number;
  paid: number;
  total_winners: number;
}

export default function StaffOrdersPage() {
  const params = useParams();
  const token = params.token as string;

  const [data, setData] = useState<{ orders: Order[]; winners: Winner[]; summary: Summary } | null>(null);
  const [tab, setTab] = useState<'orders' | 'winners'>('orders');
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all');

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/staff/orders?token=${encodeURIComponent(token)}`);
      const d = await res.json();
      if (!res.ok) {
        setData({ orders: [], winners: [], summary: { total_orders: 0, pending: 0, paid: 0, total_winners: 0 } });
      } else {
        setData(d);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, []);

  const markStatus = async (id: number, status: string) => {
    await fetch(`/api/staff/orders?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    });
    load();
  };

  const isPendingStatus = (s: string) => s === 'pending' || s === 'pending_cash' || s === 'awaiting_payment';
  const isPaidStatus = (s: string) => s === 'paid' || s === 'completed';
  const filteredOrders = data?.orders.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'pending') return isPendingStatus(o.status);
    if (filter === 'paid') return isPaidStatus(o.status);
    return true;
  }) ?? [];

  return (
    <div className="min-h-screen p-3 sm:p-4" style={{ background: 'linear-gradient(135deg, #f27a1a 0%, #dc4c04 100%)' }}>
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-3">
          <ShoppingBag size={24} className="text-white" />
          <h1 className="text-xl font-black text-white">物販ブース</h1>
          <button
            onClick={load}
            className="ml-auto p-2 rounded-full"
            style={{ background: 'rgba(255,255,255,0.2)' }}
          >
            <RefreshCw size={14} className={`text-white ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-2 mb-3">
          <div className="rounded-xl px-2 py-3 text-center" style={{ background: 'rgba(255,255,255,0.95)' }}>
            <div className="text-xl font-black text-orange-600">{data?.summary.total_orders ?? '-'}</div>
            <div className="text-[10px] text-gray-600">予約合計</div>
          </div>
          <div className="rounded-xl px-2 py-3 text-center" style={{ background: 'rgba(255,255,255,0.95)' }}>
            <div className="text-xl font-black text-yellow-600">{data?.summary.pending ?? '-'}</div>
            <div className="text-[10px] text-gray-600">未受け取り</div>
          </div>
          <div className="rounded-xl px-2 py-3 text-center" style={{ background: 'rgba(255,255,255,0.95)' }}>
            <div className="text-xl font-black text-green-600">{data?.summary.paid ?? '-'}</div>
            <div className="text-[10px] text-gray-600">受け取り済</div>
          </div>
          <div className="rounded-xl px-2 py-3 text-center" style={{ background: 'rgba(255,255,255,0.95)' }}>
            <div className="text-xl font-black text-purple-600">{data?.summary.total_winners ?? '-'}</div>
            <div className="text-[10px] text-gray-600">くじ当選</div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-3">
          <button
            onClick={() => setTab('orders')}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold"
            style={{ background: tab === 'orders' ? '#fff' : 'rgba(255,255,255,0.2)', color: tab === 'orders' ? '#dc4c04' : '#fff' }}
          >
            🛒 グッズ予約
          </button>
          <button
            onClick={() => setTab('winners')}
            className="flex-1 py-2.5 rounded-xl text-sm font-bold"
            style={{ background: tab === 'winners' ? '#fff' : 'rgba(255,255,255,0.2)', color: tab === 'winners' ? '#dc4c04' : '#fff' }}
          >
            🎰 くじ当選
          </button>
        </div>

        {/* Orders tab */}
        {tab === 'orders' && (
          <>
            <div className="flex gap-2 mb-2 text-xs">
              {(['all', 'pending', 'paid'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className="px-3 py-1.5 rounded-full font-bold"
                  style={{
                    background: filter === f ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.15)',
                    color: '#fff',
                  }}
                >
                  {f === 'all' ? 'すべて' : f === 'pending' ? '未受取' : '受取済'}
                </button>
              ))}
            </div>

            <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.95)' }}>
              {filteredOrders.length === 0 ? (
                <div className="text-center py-10 text-gray-500 text-sm">該当の予約はありません</div>
              ) : (
                <ul>
                  {filteredOrders.map((o) => {
                    const isPending = isPendingStatus(o.status);
                    return (
                      <li key={o.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: '1px solid #eee' }}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-gray-900 truncate">{o.buyer_name || '名前未入力'}</span>
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{
                                background: isPending ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.15)',
                                color: isPending ? '#a16207' : '#15803d',
                              }}
                            >
                              {isPending ? '未受取' : '受取済'}
                            </span>
                          </div>
                          <div className="text-xs text-gray-700 mt-0.5">
                            {o.merch_name} {o.color && `/ ${o.color}`} {o.size && `/ ${o.size}`} × {o.quantity}
                          </div>
                          <div className="text-[10px] text-gray-500 mt-0.5">
                            ¥{(o.price * o.quantity).toLocaleString()} ・
                            {o.payment_method === 'online_square' ? 'オンライン決済済' : '当日現金'} ・
                            {o.created_at}
                          </div>
                        </div>
                        {isPending ? (
                          <button
                            onClick={() => markStatus(o.id, 'completed')}
                            className="px-3 py-2 rounded-xl text-xs font-bold text-white flex items-center gap-1 shrink-0"
                            style={{ background: '#22c55e' }}
                          >
                            <Check size={14} />受取済
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              if (confirm('この予約を「未受取」に戻しますか？')) markStatus(o.id, 'pending_cash');
                            }}
                            className="px-2.5 py-2 rounded-xl text-[11px] font-bold flex items-center gap-1 shrink-0"
                            style={{ background: 'rgba(234,179,8,0.15)', color: '#a16207', border: '1px solid rgba(234,179,8,0.4)' }}
                            title="未受取に戻す"
                          >
                            ↩ 戻す
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {/* Winners tab */}
        {tab === 'winners' && (
          <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.95)' }}>
            {data && data.winners.length > 0 ? (
              <ul>
                {data.winners.map((w, i) => (
                  <li key={w.id} className="px-4 py-3 flex items-center gap-3" style={{ borderTop: '1px solid #eee' }}>
                    <span className="text-lg font-black text-orange-600 w-8 shrink-0">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-gray-900">
                        {w.winner_name ? w.winner_name : <span className="text-gray-400 text-xs">名前未入力</span>}
                      </div>
                      <div className="text-[11px] text-gray-700 mt-0.5">{w.prize_name}</div>
                      <div className="text-[10px] text-gray-400 mt-0.5">{w.created_at}</div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-10 text-gray-500">
                <Trophy size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">まだ当選者はいません</p>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 p-3 rounded-xl text-[11px] text-white/90" style={{ background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(8px)' }}>
          🏪 8秒ごと自動更新。iPadのホーム画面に追加してご利用ください。
        </div>
      </div>
    </div>
  );
}
