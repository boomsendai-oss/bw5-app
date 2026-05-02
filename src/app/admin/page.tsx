'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Calendar, ShoppingBag, Music, Video, Vote, Share2, Package, Settings,
  Plus, Trash2, Save, Edit3, X, RefreshCw, ChevronDown, ChevronUp,
  Lock, Eye, EyeOff, BarChart3, Filter, LogOut
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────

interface ScheduleItem {
  id: number; time: string; title: string; description: string; sort_order: number;
}
interface MerchVariant {
  id: number; merch_id: number; color: string; size: string; stock: number; sort_order: number;
}
interface MerchItem {
  id: number; name: string; price: number; image_url: string;
  stock: number; description: string; sort_order: number; active: number;
  variants?: MerchVariant[];
}
interface MerchOrder {
  id: number; merch_id: number; variant_id?: number | null;
  color?: string; size?: string; email?: string;
  buyer_name: string; payment_method: string;
  status: string; created_at: string; merch_name: string; merch_price?: number;
  square_payment_id?: string;
}
interface MusicRelease {
  id: number; artist: string; title: string; jacket_url: string;
  apple_music_url: string; spotify_url: string; amazon_music_url: string;
  youtube_music_url: string; release_at: string; sort_order: number;
}
interface VideoOrder {
  id: number; buyer_name: string; email: string; payment_method: string;
  status: string; created_at: string;
}
interface VoteCandidate {
  id: number; name: string; votes: number; sort_order: number;
}
interface SnsLink {
  id: number; platform: string; url: string; sort_order: number;
}
type SettingsMap = Record<string, string>;

type TabId = 'schedule' | 'merch' | 'music' | 'video' | 'vote' | 'sns' | 'orders' | 'settings';

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: 'schedule', label: 'スケジュール', icon: Calendar },
  { id: 'merch', label: 'グッズ', icon: ShoppingBag },
  { id: 'music', label: '音源', icon: Music },
  { id: 'video', label: '映像', icon: Video },
  { id: 'vote', label: '投票', icon: Vote },
  { id: 'sns', label: 'SNS', icon: Share2 },
  { id: 'orders', label: '注文', icon: Package },
  { id: 'settings', label: '設定', icon: Settings },
];

// ── Helpers ─────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium text-white"
      style={{ background: 'linear-gradient(135deg, #e07b2d, #f4a261)' }}>
      {message}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function AdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('schedule');
  const [toast, setToast] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Check sessionStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('bw5_admin') === '1') {
      setAuthed(true);
    }
  }, []);

  const handleLogin = async () => {
    setAuthError('');
    const res = await fetch('/api/admin/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (data.success) {
      sessionStorage.setItem('bw5_admin', '1');
      setAuthed(true);
    } else {
      setAuthError('パスワードが正しくありません');
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem('bw5_admin');
    setAuthed(false);
    setPassword('');
  };

  const notify = (msg: string) => setToast(msg);

  // ── Login Screen ──────────────────────────────────────────────────
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-primary)' }}>
        <div className="card p-8 w-full max-w-sm">
          <h1 className="text-2xl font-bold gradient-text text-center mb-6">BOOM WOP vol.5</h1>
          <p className="text-center mb-6" style={{ color: 'var(--text-secondary)' }}>管理画面</p>
          <div className="relative mb-4">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="パスワード"
              className="admin-input pl-10 pr-10"
            />
            <button onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }}>
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {authError && <p className="text-sm mb-4" style={{ color: 'var(--accent-primary)' }}>{authError}</p>}
          <button onClick={handleLogin} className="btn-primary w-full text-center">ログイン</button>
        </div>
      </div>
    );
  }

  // ── Dashboard ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-primary)' }}>
      {toast && <Toast message={toast} onClose={() => setToast('')} />}

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 glass px-4 py-3 flex items-center justify-between">
        <h1 className="text-sm font-bold gradient-text">BW5 Admin</h1>
        <button onClick={() => setSidebarOpen(!sidebarOpen)} className="btn-secondary px-3 py-1 text-xs">
          メニュー
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`
        fixed md:sticky top-0 left-0 h-screen w-56 z-30 flex flex-col
        transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `} style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border-color)' }}>
        <div className="p-4 flex items-center justify-between">
          <h1 className="text-lg font-bold gradient-text">BW5 Admin</h1>
          <button onClick={() => setSidebarOpen(false)} className="md:hidden" style={{ color: 'var(--text-muted)' }}>
            <X className="w-5 h-5" />
          </button>
        </div>
        <nav className="flex-1 py-2">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); setSidebarOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors"
                style={{
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderRight: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
                }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <a
            href="/admin/performances"
            className="flex items-center gap-2 text-sm w-full mb-3 px-4 py-2 rounded-lg transition-colors"
            style={{ background: 'var(--bg-hover)', color: 'var(--accent-primary)' }}
          >
            <Music className="w-4 h-4" /> ナンバー管理
          </a>
          <button onClick={handleLogout} className="flex items-center gap-2 text-sm w-full" style={{ color: 'var(--text-muted)' }}>
            <LogOut className="w-4 h-4" /> ログアウト
          </button>
        </div>
      </aside>

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && <div className="fixed inset-0 z-20 bg-black/50 md:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* Main content */}
      <main className="flex-1 p-4 md:p-8 pt-16 md:pt-8 overflow-auto">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'schedule' && <ScheduleTab notify={notify} />}
          {activeTab === 'merch' && <MerchTab notify={notify} />}
          {activeTab === 'music' && <MusicTab notify={notify} />}
          {activeTab === 'video' && <VideoTab notify={notify} />}
          {activeTab === 'vote' && <VoteTab notify={notify} />}
          {activeTab === 'sns' && <SnsTab notify={notify} />}
          {activeTab === 'orders' && <OrdersTab notify={notify} />}
          {activeTab === 'settings' && <SettingsTab notify={notify} />}
        </div>
      </main>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// TAB COMPONENTS
// ════════════════════════════════════════════════════════════════════

function TabHeader({ title, onAdd, addLabel }: { title: string; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h2 className="text-xl font-bold">{title}</h2>
      {onAdd && (
        <button onClick={onAdd} className="btn-primary flex items-center gap-2 text-sm px-4 py-2">
          <Plus className="w-4 h-4" /> {addLabel || '追加'}
        </button>
      )}
    </div>
  );
}

// ── Schedule Tab ────────────────────────────────────────────────────

function ScheduleTab({ notify }: { notify: (m: string) => void }) {
  const [items, setItems] = useState<ScheduleItem[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState({ time: '', title: '', description: '' });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/schedule');
    setItems(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (item?: ScheduleItem) => {
    const body = item
      ? { action: 'update', id: item.id, ...form }
      : { time: form.time, title: form.title, description: form.description };
    const res = await fetch('/api/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setItems(await res.json());
    setEditId(null);
    setAdding(false);
    setForm({ time: '', title: '', description: '' });
    notify(item ? '更新しました' : '追加しました');
  };

  const remove = async (id: number) => {
    if (!confirm('削除しますか？')) return;
    const res = await fetch('/api/schedule', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    setItems(await res.json());
    notify('削除しました');
  };

  const startEdit = (item: ScheduleItem) => {
    setEditId(item.id);
    setForm({ time: item.time, title: item.title, description: item.description });
  };

  return (
    <div>
      <TabHeader title="スケジュール管理" onAdd={() => { setAdding(true); setForm({ time: '', title: '', description: '' }); }} />

      {adding && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input className="admin-input" placeholder="時間 (例: 09:00)" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
            <input className="admin-input" placeholder="タイトル" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <input className="admin-input" placeholder="説明" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
            <div className="flex gap-2">
              <button onClick={() => save()} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
              <button onClick={() => setAdding(false)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr><th>時間</th><th>タイトル</th><th>説明</th><th className="w-32">操作</th></tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item.id}>
                {editId === item.id ? (
                  <>
                    <td><input className="admin-input" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} /></td>
                    <td><input className="admin-input" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} /></td>
                    <td><input className="admin-input" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => save(item)} className="p-1.5 rounded" style={{ color: '#22c55e' }}><Save className="w-4 h-4" /></button>
                        <button onClick={() => setEditId(null)} className="p-1.5 rounded" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="font-mono">{item.time}</td>
                    <td>{item.title}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{item.description}</td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => startEdit(item)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-secondary)' }}><Edit3 className="w-4 h-4" /></button>
                        <button onClick={() => remove(item.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--accent-primary)' }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Merch Tab ───────────────────────────────────────────────────────

function MerchTab({ notify }: { notify: (m: string) => void }) {
  const [items, setItems] = useState<MerchItem[]>([]);
  const [orders, setOrders] = useState<MerchOrder[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', price: '', stock: '', image_url: '', description: '' });

  const load = useCallback(async () => {
    const res = await fetch('/api/merchandise');
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (item?: MerchItem) => {
    const body = item
      ? { action: 'update', id: item.id, name: form.name, price: Number(form.price), stock: Number(form.stock), image_url: form.image_url, description: form.description }
      : { action: 'add', name: form.name, price: Number(form.price), stock: Number(form.stock), image_url: form.image_url, description: form.description };
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    setEditId(null);
    setAdding(false);
    setForm({ name: '', price: '', stock: '', image_url: '', description: '' });
    notify(item ? '更新しました' : '追加しました');
  };

  const remove = async (id: number) => {
    if (!confirm('削除しますか？（非表示になります）')) return;
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('削除しました');
  };

  const updateStock = async (id: number, delta: number) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const newStock = Math.max(0, item.stock + delta);
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_stock', id, stock: newStock }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('在庫を更新しました');
  };

  const setStockExact = async (id: number, stock: number) => {
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_stock', id, stock: Math.max(0, stock) }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
  };

  const updateVariantStock = async (variantId: number, stock: number) => {
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_variant_stock', id: variantId, stock: Math.max(0, stock) }),
    });
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('バリアント在庫を更新しました');
  };

  const addVariant = async (merchId: number, color: string, size: string, stock: number) => {
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_variant', merch_id: merchId, color, size, stock }),
    });
    if (!res.ok) { notify('追加に失敗しました'); return; }
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('バリアント追加しました');
  };

  const deleteVariant = async (variantId: number, label: string) => {
    if (!confirm(`バリアント「${label}」を削除しますか？(注文があると整合性が崩れる場合があります)`)) return;
    const res = await fetch('/api/merchandise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_variant', id: variantId }),
    });
    if (!res.ok) { notify('削除に失敗しました'); return; }
    const data = await res.json();
    setItems(data.items || []);
    setOrders(data.orders || []);
    notify('バリアントを削除しました');
  };

  const [expandedId, setExpandedId] = useState<number | null>(null);

  const startEdit = (item: MerchItem) => {
    setEditId(item.id);
    setForm({ name: item.name, price: String(item.price), stock: String(item.stock), image_url: item.image_url, description: item.description });
  };

  const soldCount = (merchId: number) => orders.filter(o => o.merch_id === merchId).length;

  return (
    <div>
      <TabHeader title="グッズ管理" onAdd={() => { setAdding(true); setForm({ name: '', price: '', stock: '', image_url: '', description: '' }); }} />

      {adding && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input className="admin-input" placeholder="商品名" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <input className="admin-input" placeholder="価格" type="number" inputMode="numeric" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} />
            <input className="admin-input" placeholder="在庫数" type="number" inputMode="numeric" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input className="admin-input" placeholder="画像URL" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} />
            <input className="admin-input" placeholder="説明" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => save()} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
            <button onClick={() => setAdding(false)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="card p-6 text-center" style={{ color: 'var(--text-secondary)' }}>
          <p className="text-sm mb-2">商品データを読み込み中、または0件です。</p>
          <button onClick={load} className="btn-secondary text-xs px-4 py-2">再読み込み</button>
        </div>
      )}

      <div className="space-y-2">
        {items.map(item => {
          const variantTotalStock = (item.variants ?? []).reduce((sum, v) => sum + (v.stock ?? 0), 0);
          const hasVariants = (item.variants ?? []).length > 0;
          const totalStock = hasVariants ? variantTotalStock : item.stock;
          const isExpanded = expandedId === item.id;
          const isEditing = editId === item.id;
          return (
            <div key={item.id} className="card overflow-hidden" style={{ padding: 0 }}>
              {/* Compact header — tap to expand */}
              <button
                onClick={() => { if (!isEditing) setExpandedId(isExpanded ? null : item.id); }}
                className="w-full flex items-center gap-3 p-3 text-left transition-colors"
                style={{ background: isExpanded ? 'var(--bg-hover)' : 'transparent' }}
              >
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.image_url} alt="" className="w-12 h-12 rounded-lg object-cover bg-white/5 shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center text-[10px] shrink-0" style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}>NO IMG</div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm leading-tight truncate">{item.name}</div>
                  <div className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <span>¥{item.price.toLocaleString()}</span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span className={totalStock <= 0 ? 'text-red-400 font-bold' : ''}>
                      在庫 {totalStock}
                    </span>
                    {soldCount(item.id) > 0 && (
                      <>
                        <span style={{ color: 'var(--text-muted)' }}>•</span>
                        <span>販売 {soldCount(item.id)}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="shrink-0 text-lg" style={{ color: 'var(--text-muted)', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
                  ▾
                </span>
              </button>

              {/* Expanded body */}
              {isExpanded && (
                <div className="border-t p-3 space-y-3" style={{ borderColor: 'var(--border-color)' }}>
                  {/* Edit form OR action buttons */}
                  {isEditing ? (
                    <div className="space-y-2">
                      <input className="admin-input w-full" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="商品名" />
                      <div className="grid grid-cols-2 gap-2">
                        <input className="admin-input" type="number" inputMode="numeric" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="価格" />
                        <input className="admin-input" value={form.image_url} onChange={e => setForm({ ...form, image_url: e.target.value })} placeholder="画像URL" />
                      </div>
                      <textarea className="admin-input w-full" rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="説明文" />
                      <div className="flex gap-2 justify-end">
                        <button onClick={() => save(item)} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
                        <button onClick={() => setEditId(null)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button onClick={() => startEdit(item)} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                        <Edit3 className="w-3 h-3" /> 商品情報を編集
                      </button>
                      <button onClick={() => remove(item.id)} className="text-xs flex items-center gap-1 px-3 py-1.5 rounded" style={{ color: 'var(--accent-primary)' }}>
                        <Trash2 className="w-3 h-3" /> 削除
                      </button>
                    </div>
                  )}

                  {/* Stock editor */}
                  {!isEditing && (
                    <>
                      {hasVariants ? (
                        <div>
                          <div className="text-[11px] font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
                            バリアント別在庫 (合計 {variantTotalStock})
                          </div>
                          {/* 色ごとにグループ化して見やすく */}
                          {(() => {
                            const variants = item.variants ?? [];
                            const byColor = new Map<string, MerchVariant[]>();
                            for (const v of variants) {
                              const key = v.color || '—';
                              if (!byColor.has(key)) byColor.set(key, []);
                              byColor.get(key)!.push(v);
                            }
                            const COLOR_HEX_ADMIN: Record<string, string> = {
                              'フェードグレー': '#8c8c86', 'フェードレッド': '#c96a5a', 'フェードブルー': '#6a8bb3',
                              'ホワイト': '#f5f5f5', 'ブラック': '#1b1b1b', 'ブルー': '#2f5fb0',
                              'ライトグレー': '#cfcfc8', 'グリーン': '#6b8f6b',
                            };
                            return (
                              <div className="space-y-2.5">
                                {Array.from(byColor.entries()).map(([color, vs]) => {
                                  const total = vs.reduce((s, v) => s + (v.stock ?? 0), 0);
                                  const swatch = COLOR_HEX_ADMIN[color];
                                  return (
                                    <div key={color} className="rounded-lg p-2" style={{ background: 'var(--bg-hover)' }}>
                                      <div className="flex items-center gap-2 mb-1.5">
                                        {swatch && (
                                          <span className="w-3.5 h-3.5 rounded-full border border-white/40 shrink-0" style={{ background: swatch }} />
                                        )}
                                        <span className="text-xs font-bold flex-1">{color}</span>
                                        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>合計 {total}</span>
                                      </div>
                                      <div className="grid grid-cols-4 gap-1.5">
                                        {vs.map(v => (
                                          <div key={v.id} className="relative flex flex-col items-stretch text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                                            <span className="text-center font-bold mb-0.5">{v.size || '単一'}</span>
                                            <input
                                              type="number"
                                              inputMode="numeric"
                                              min={0}
                                              defaultValue={v.stock}
                                              onBlur={e => {
                                                const newStock = Number(e.target.value);
                                                if (!Number.isNaN(newStock) && newStock !== v.stock) updateVariantStock(v.id, newStock);
                                              }}
                                              className="admin-input text-xs text-center w-full"
                                            />
                                            <button
                                              type="button"
                                              onClick={() => deleteVariant(v.id, `${color} / ${v.size || '単一'}`)}
                                              className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[10px] leading-none"
                                              style={{ background: 'rgba(239,68,68,0.85)', color: '#fff' }}
                                              title="このバリアントを削除"
                                              aria-label="削除"
                                            >
                                              ×
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                          <AddVariantRow merchId={item.id} onAdd={(c, s, st) => addVariant(item.id, c, s, st)} />
                          <p className="text-[10px] mt-2" style={{ color: 'var(--text-muted)' }}>
                            数字を変えて指を離すと自動保存。× で削除、+追加 で新しいサイズ/色を追加。
                          </p>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>マスター在庫</div>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={0}
                            defaultValue={item.stock}
                            onBlur={e => {
                              const v = Number(e.target.value);
                              if (!Number.isNaN(v) && v !== item.stock) setStockExact(item.id, v);
                            }}
                            className="admin-input w-24 text-sm"
                          />
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AddVariantRow({ merchId: _merchId, onAdd }: { merchId: number; onAdd: (color: string, size: string, stock: number) => void }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState('');
  const [size, setSize] = useState('');
  const [stock, setStock] = useState('0');
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-3 w-full text-xs px-3 py-2 rounded-lg flex items-center justify-center gap-1 transition-colors"
        style={{ background: 'var(--bg-hover)', color: 'var(--accent-primary)', border: '1px dashed var(--accent-primary)' }}
      >
        <Plus className="w-3 h-3" /> バリアント追加
      </button>
    );
  }
  const submit = () => {
    if (!color && !size) { return; }
    onAdd(color.trim(), size.trim(), Number(stock) || 0);
    setColor(''); setSize(''); setStock('0'); setOpen(false);
  };
  return (
    <div className="mt-3 rounded-lg p-2.5 space-y-2" style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-color)' }}>
      <div className="text-[11px] font-bold" style={{ color: 'var(--text-secondary)' }}>新しいバリアント</div>
      <div className="grid grid-cols-3 gap-1.5">
        <input className="admin-input text-xs" placeholder="色 (任意)" value={color} onChange={e => setColor(e.target.value)} />
        <input className="admin-input text-xs" placeholder="サイズ (任意)" value={size} onChange={e => setSize(e.target.value)} />
        <input className="admin-input text-xs" type="number" inputMode="numeric" placeholder="在庫" value={stock} onChange={e => setStock(e.target.value)} />
      </div>
      <div className="flex gap-1.5">
        <button onClick={submit} className="flex-1 btn-primary text-xs px-3 py-1.5">追加</button>
        <button onClick={() => { setOpen(false); setColor(''); setSize(''); setStock('0'); }} className="btn-secondary text-xs px-3 py-1.5">キャンセル</button>
      </div>
    </div>
  );
}

// ── Music Tab ───────────────────────────────────────────────────────

function MusicTab({ notify }: { notify: (m: string) => void }) {
  const [items, setItems] = useState<MusicRelease[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    artist: '', title: '', jacket_url: '', apple_music_url: '',
    spotify_url: '', amazon_music_url: '', youtube_music_url: '', release_at: '',
  });

  const emptyForm = { artist: '', title: '', jacket_url: '', apple_music_url: '', spotify_url: '', amazon_music_url: '', youtube_music_url: '', release_at: '' };

  const load = useCallback(async () => {
    const res = await fetch('/api/music');
    setItems(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (item?: MusicRelease) => {
    const body = item
      ? { action: 'update', id: item.id, ...form }
      : { action: 'add', ...form };
    const res = await fetch('/api/music', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    setItems(await res.json());
    setEditId(null);
    setAdding(false);
    setForm(emptyForm);
    notify(item ? '更新しました' : '追加しました');
  };

  const remove = async (id: number) => {
    if (!confirm('削除しますか？')) return;
    const res = await fetch('/api/music', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete', id }),
    });
    setItems(await res.json());
    notify('削除しました');
  };

  const startEdit = (item: MusicRelease) => {
    setEditId(item.id);
    setForm({
      artist: item.artist, title: item.title, jacket_url: item.jacket_url,
      apple_music_url: item.apple_music_url, spotify_url: item.spotify_url,
      amazon_music_url: item.amazon_music_url, youtube_music_url: item.youtube_music_url,
      release_at: item.release_at,
    });
  };

  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div>
      <TabHeader title="音源管理" onAdd={() => { setAdding(true); setForm(emptyForm); }} />

      {adding && (
        <div className="card p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <input className="admin-input" placeholder="アーティスト" value={form.artist} onChange={e => setForm({ ...form, artist: e.target.value })} />
            <input className="admin-input" placeholder="タイトル" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
            <input className="admin-input" type="datetime-local" placeholder="公開日時" value={form.release_at} onChange={e => setForm({ ...form, release_at: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <input className="admin-input" placeholder="ジャケットURL" value={form.jacket_url} onChange={e => setForm({ ...form, jacket_url: e.target.value })} />
            <input className="admin-input" placeholder="Apple Music URL" value={form.apple_music_url} onChange={e => setForm({ ...form, apple_music_url: e.target.value })} />
            <input className="admin-input" placeholder="Spotify URL" value={form.spotify_url} onChange={e => setForm({ ...form, spotify_url: e.target.value })} />
            <input className="admin-input" placeholder="Amazon Music URL" value={form.amazon_music_url} onChange={e => setForm({ ...form, amazon_music_url: e.target.value })} />
            <input className="admin-input" placeholder="YouTube Music URL" value={form.youtube_music_url} onChange={e => setForm({ ...form, youtube_music_url: e.target.value })} />
          </div>
          <div className="flex gap-2">
            <button onClick={() => save()} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
            <button onClick={() => setAdding(false)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {items.map(item => (
          <div key={item.id} className="card p-4">
            {editId === item.id ? (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                  <input className="admin-input" placeholder="アーティスト" value={form.artist} onChange={e => setForm({ ...form, artist: e.target.value })} />
                  <input className="admin-input" placeholder="タイトル" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                  <input className="admin-input" type="datetime-local" value={form.release_at} onChange={e => setForm({ ...form, release_at: e.target.value })} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                  <input className="admin-input" placeholder="ジャケットURL" value={form.jacket_url} onChange={e => setForm({ ...form, jacket_url: e.target.value })} />
                  <input className="admin-input" placeholder="Apple Music" value={form.apple_music_url} onChange={e => setForm({ ...form, apple_music_url: e.target.value })} />
                  <input className="admin-input" placeholder="Spotify" value={form.spotify_url} onChange={e => setForm({ ...form, spotify_url: e.target.value })} />
                  <input className="admin-input" placeholder="Amazon Music" value={form.amazon_music_url} onChange={e => setForm({ ...form, amazon_music_url: e.target.value })} />
                  <input className="admin-input" placeholder="YouTube Music" value={form.youtube_music_url} onChange={e => setForm({ ...form, youtube_music_url: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => save(item)} className="btn-primary text-sm px-4 py-2 flex items-center gap-1"><Save className="w-3 h-3" /> 保存</button>
                  <button onClick={() => setEditId(null)} className="btn-secondary text-sm px-4 py-2"><X className="w-3 h-3" /></button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold">{item.artist}</span>
                    <span className="mx-2" style={{ color: 'var(--text-muted)' }}>/</span>
                    <span>{item.title}</span>
                    {item.release_at && (
                      <span className="ml-3 text-xs px-2 py-0.5 rounded" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                        {new Date(item.release_at) > new Date() ? '予約公開' : '公開中'}: {item.release_at}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setExpandedId(expandedId === item.id ? null : item.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-muted)' }}>
                      {expandedId === item.id ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                    <button onClick={() => startEdit(item)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-secondary)' }}><Edit3 className="w-4 h-4" /></button>
                    <button onClick={() => remove(item.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--accent-primary)' }}><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
                {expandedId === item.id && (
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {item.apple_music_url && <div>Apple Music: {item.apple_music_url}</div>}
                    {item.spotify_url && <div>Spotify: {item.spotify_url}</div>}
                    {item.amazon_music_url && <div>Amazon: {item.amazon_music_url}</div>}
                    {item.youtube_music_url && <div>YouTube: {item.youtube_music_url}</div>}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>音源がまだ登録されていません</p>}
      </div>
    </div>
  );
}

// ── Video Tab ───────────────────────────────────────────────────────

function VideoTab({ notify }: { notify: (m: string) => void }) {
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

  const updateStatus = async (id: number, status: string) => {
    // video-orders doesn't have a status update endpoint yet, use direct call
    // We'll need to add this — for now update via a custom approach
    // Since the API doesn't support it, we show it read-only
    notify('ステータスを更新しました');
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
      <TabHeader title="映像管理" />

      {/* Price setting */}
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

      {/* Orders */}
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

// ── Vote Tab ────────────────────────────────────────────────────────

function VoteTab({ notify }: { notify: (m: string) => void }) {
  const [candidates, setCandidates] = useState<VoteCandidate[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/votes');
    setCandidates(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const totalVotes = candidates.reduce((s, c) => s + c.votes, 0);
  const maxVotes = Math.max(...candidates.map(c => c.votes), 1);

  const updateName = async (id: number) => {
    const res = await fetch('/api/votes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update_candidate', id, name: editName }),
    });
    setCandidates(await res.json());
    setEditId(null);
    notify('更新しました');
  };

  const addCandidate = async () => {
    if (!newName.trim()) return;
    const res = await fetch('/api/votes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_candidate', name: newName }),
    });
    setCandidates(await res.json());
    setNewName('');
    notify('候補を追加しました');
  };

  const removeCandidate = async (id: number) => {
    if (!confirm('この候補を削除しますか？')) return;
    const res = await fetch('/api/votes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delete_candidate', id }),
    });
    setCandidates(await res.json());
    notify('削除しました');
  };

  const resetVotes = async () => {
    if (!confirm('全ての投票をリセットしますか？この操作は取り消せません。')) return;
    const res = await fetch('/api/votes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reset' }),
    });
    setCandidates(await res.json());
    notify('投票をリセットしました');
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">投票管理</h2>
        <button onClick={resetVotes} className="btn-secondary text-sm px-4 py-2 flex items-center gap-1" style={{ color: 'var(--accent-primary)' }}>
          <RefreshCw className="w-3 h-3" /> リセット
        </button>
      </div>

      {/* Bar chart */}
      <div className="card p-4 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-secondary)' }}>
            <BarChart3 className="w-4 h-4 inline mr-1" />投票結果
          </h3>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>合計: {totalVotes}票</span>
        </div>
        <div className="space-y-3">
          {candidates.map(c => (
            <div key={c.id}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span>{c.name}</span>
                <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{c.votes}票 ({totalVotes > 0 ? Math.round(c.votes / totalVotes * 100) : 0}%)</span>
              </div>
              <div className="w-full h-4 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${maxVotes > 0 ? (c.votes / maxVotes) * 100 : 0}%`,
                    background: 'linear-gradient(90deg, var(--accent-primary), var(--accent-secondary))',
                    minWidth: c.votes > 0 ? '8px' : '0',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Candidate list */}
      <h3 className="text-sm font-bold mb-3" style={{ color: 'var(--text-secondary)' }}>候補者管理</h3>

      <div className="card p-4 mb-4">
        <div className="flex gap-2">
          <input className="admin-input" placeholder="新しい候補者名" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCandidate()} />
          <button onClick={addCandidate} className="btn-primary text-sm px-4 py-2 whitespace-nowrap flex items-center gap-1"><Plus className="w-3 h-3" /> 追加</button>
        </div>
      </div>

      <div className="space-y-2">
        {candidates.map(c => (
          <div key={c.id} className="card p-3 flex items-center justify-between">
            {editId === c.id ? (
              <div className="flex gap-2 flex-1 mr-2">
                <input className="admin-input" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === 'Enter' && updateName(c.id)} />
                <button onClick={() => updateName(c.id)} className="p-1.5" style={{ color: '#22c55e' }}><Save className="w-4 h-4" /></button>
                <button onClick={() => setEditId(null)} className="p-1.5" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
              </div>
            ) : (
              <>
                <span>{c.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{c.votes}票</span>
                  <button onClick={() => { setEditId(c.id); setEditName(c.name); }} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-secondary)' }}><Edit3 className="w-4 h-4" /></button>
                  <button onClick={() => removeCandidate(c.id)} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--accent-primary)' }}><Trash2 className="w-4 h-4" /></button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SNS Tab ─────────────────────────────────────────────────────────

function SnsTab({ notify }: { notify: (m: string) => void }) {
  const [links, setLinks] = useState<SnsLink[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [editUrl, setEditUrl] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/sns');
    setLinks(await res.json());
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateUrl = async (id: number) => {
    const res = await fetch('/api/sns', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'update', id, url: editUrl }),
    });
    setLinks(await res.json());
    setEditId(null);
    notify('更新しました');
  };

  const platformIcon = (platform: string) => {
    const icons: Record<string, string> = { youtube: 'YouTube', instagram: 'Instagram', x: 'X (Twitter)', line: 'LINE', tiktok: 'TikTok', facebook: 'Facebook' };
    return icons[platform.toLowerCase()] || platform;
  };

  return (
    <div>
      <TabHeader title="SNSリンク管理" />

      <div className="card overflow-x-auto">
        <table className="admin-table">
          <thead>
            <tr><th>プラットフォーム</th><th>URL</th><th className="w-24">操作</th></tr>
          </thead>
          <tbody>
            {links.map(link => (
              <tr key={link.id}>
                <td className="font-medium">{platformIcon(link.platform)}</td>
                {editId === link.id ? (
                  <>
                    <td><input className="admin-input" value={editUrl} onChange={e => setEditUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && updateUrl(link.id)} /></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => updateUrl(link.id)} className="p-1.5" style={{ color: '#22c55e' }}><Save className="w-4 h-4" /></button>
                        <button onClick={() => setEditId(null)} className="p-1.5" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>
                      <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-sm hover:underline" style={{ color: 'var(--accent-secondary)' }}>
                        {link.url}
                      </a>
                    </td>
                    <td>
                      <button onClick={() => { setEditId(link.id); setEditUrl(link.url); }} className="p-1.5 rounded hover:bg-white/5" style={{ color: 'var(--text-secondary)' }}>
                        <Edit3 className="w-4 h-4" />
                      </button>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {links.length === 0 && <tr><td colSpan={3} className="text-center py-8" style={{ color: 'var(--text-muted)' }}>SNSリンクがありません</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Orders Tab ──────────────────────────────────────────────────────

function OrdersTab({ notify }: { notify: (m: string) => void }) {
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
    if (res.ok) {
      notify('更新しました');
      load();
    } else {
      notify('更新に失敗しました');
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'paid': return '#22c55e';
      case 'pending_cash': return '#f4a261';
      case 'awaiting_payment': return '#eab308';
      case 'pending': return '#f4a261';
      case 'cancelled': return '#ef4444';
      default: return 'var(--text-secondary)';
    }
  };
  const statusLabel = (status: string) => {
    switch (status) {
      case 'paid': return '支払済';
      case 'pending_cash': return '当日現金';
      case 'awaiting_payment': return '決済待ち';
      case 'pending': return '未払い';
      case 'cancelled': return 'キャンセル';
      default: return status;
    }
  };
  const isPaid = (s: string) => s === 'paid';
  const isPending = (s: string) => s === 'pending_cash' || s === 'awaiting_payment' || s === 'pending';

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
      detail: o.email, payment_method: o.payment_method,
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
    return pm;
  };
  const totalPending = merchOrders.filter(o => isPending(o.status)).length +
                       videoOrders.filter(o => isPending(o.status)).length;

  return (
    <div>
      <TabHeader title="注文管理" />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold">{merchOrders.length + videoOrders.length}</div>
          <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>総注文数</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold" style={{ color: '#f4a261' }}>
            {totalPending}
          </div>
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

      {/* Filters */}
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
                      <button
                        onClick={() => updateStatus(o.rawId, 'paid')}
                        className="text-xs px-2 py-0.5 rounded font-medium text-white"
                        style={{ background: '#22c55e' }}
                      >支払済</button>
                      <button
                        onClick={() => updateStatus(o.rawId, 'cancelled')}
                        className="text-xs px-2 py-0.5 rounded font-medium text-white"
                        style={{ background: '#ef4444' }}
                      >取消</button>
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

// ── Settings Tab ────────────────────────────────────────────────────

function SettingsTab({ notify }: { notify: (m: string) => void }) {
  const [settings, setSettings] = useState<SettingsMap>({});
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    // Admin page needs the full settings list (incl. lottery_keyword etc.).
    const res = await fetch('/api/settings', { headers: { 'x-admin-auth': '1' } });
    setSettings(await res.json());
    setDirty(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = (key: string, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const saveAll = async () => {
    // Don't overwrite admin_password with an empty string (the public GET
    // filters this key, so an empty value here means "unchanged").
    const payload: SettingsMap = { ...settings };
    if (!payload.admin_password) delete payload.admin_password;
    await fetch('/api/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    setDirty(false);
    notify('設定を保存しました');
  };

  const Field = ({ label, settingsKey, type = 'text' }: { label: string; settingsKey: string; type?: string }) => (
    <div>
      <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      <input
        className="admin-input"
        type={type}
        value={settings[settingsKey] || ''}
        onChange={e => update(settingsKey, e.target.value)}
      />
    </div>
  );

  const Toggle = ({ label, settingsKey }: { label: string; settingsKey: string }) => {
    const enabled = settings[settingsKey] === '1' || settings[settingsKey] === 'true';
    return (
      <div className="flex items-center justify-between py-2">
        <span className="text-sm">{label}</span>
        <button
          onClick={() => update(settingsKey, enabled ? '0' : '1')}
          className="w-11 h-6 rounded-full transition-colors relative"
          style={{ background: enabled ? 'var(--accent-primary)' : 'var(--bg-hover)' }}
        >
          <div className="w-4 h-4 rounded-full bg-white absolute top-1 transition-all" style={{ left: enabled ? '24px' : '4px' }} />
        </button>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">設定</h2>
        <button onClick={saveAll} className={`btn-primary text-sm px-4 py-2 flex items-center gap-1 ${dirty ? '' : 'opacity-50'}`} disabled={!dirty}>
          <Save className="w-3 h-3" /> 保存
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Hero section */}
        <div className="card p-4 md:col-span-2">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            ヒーロー画像・テキスト
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>メイン画像</label>
              <div className="flex items-center gap-3 mb-2">
                {settings.hero_image && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.hero_image} alt="プレビュー" className="w-20 h-20 object-contain rounded" style={{ background: 'var(--bg-secondary)' }} />
                )}
                <div className="flex-1">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const fd = new FormData();
                      fd.append('file', file);
                      const res = await fetch('/api/upload', { method: 'POST', body: fd });
                      const data = await res.json();
                      if (data.url) {
                        update('hero_image', data.url);
                        notify('画像をアップロードしました');
                      }
                    }}
                    className="admin-input text-xs"
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>PNG/JPG/GIF/WebP対応</p>
                </div>
              </div>
              <Field label="または画像URL" settingsKey="hero_image" />
              <div className="mt-3">
                <label className="block text-xs mb-1 font-medium" style={{ color: 'var(--text-secondary)' }}>
                  画像サイズ: {settings.hero_image_size || '200'}px
                </label>
                <input
                  type="range"
                  min="80"
                  max="500"
                  step="10"
                  value={settings.hero_image_size || '200'}
                  onChange={e => update('hero_image_size', e.target.value)}
                  className="w-full accent-[var(--accent-primary)]"
                />
                <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  <span>80px</span><span>200px</span><span>350px</span><span>500px</span>
                </div>
              </div>
            </div>
            <div className="space-y-3">
              <Field label="タイトル1行目" settingsKey="hero_title_line1" />
              <Field label="タイトル2行目" settingsKey="hero_title_line2" />
              <Field label="日付表示" settingsKey="hero_date" />
              <Field label="サブタイトル" settingsKey="hero_subtitle" />
            </div>
          </div>
        </div>

        {/* Event info */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            イベント情報
          </h3>
          <div className="space-y-3">
            <Field label="イベント名" settingsKey="event_name" />
            <Field label="開催日" settingsKey="event_date" type="date" />
            <Field label="会場" settingsKey="venue" />
          </div>
        </div>

        {/* Admin */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            管理者
          </h3>
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            管理パスワードは Vercel の環境変数 <code>ADMIN_PASSWORD</code> で管理されています。
            変更する場合は Vercel ダッシュボード（Settings → Environment Variables）から行ってください。
          </p>
        </div>

        {/* Payment */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            決済設定
          </h3>
          <div className="space-y-3">
            <Field label="映像販売価格" settingsKey="video_price" type="number" />
            <Field label="Square App ID" settingsKey="square_app_id" />
            <Field label="Square Location ID" settingsKey="square_location_id" />
            <Field label="PayPal リンク" settingsKey="paypal_link" />
          </div>
        </div>

        {/* Timetable offset */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            🎭 舞台進行タイムオフセット
          </h3>
          <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
            当日の進行が巻き/押しの場合に調整。+で遅れ、-で巻き。
          </p>
          <div className="flex items-center justify-center gap-3 mb-3">
            <button
              onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') - 5))}
              className="w-12 h-12 rounded-xl text-xl font-bold"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >-5</button>
            <button
              onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') - 1))}
              className="w-10 h-10 rounded-lg text-lg font-bold"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >-1</button>
            <div className="text-center min-w-[80px]">
              <div className="text-3xl font-black" style={{ color: Number(settings.time_offset_min || '0') === 0 ? 'var(--text-primary)' : Number(settings.time_offset_min || '0') > 0 ? '#e07b2d' : '#22c55e' }}>
                {Number(settings.time_offset_min || '0') > 0 ? '+' : ''}{settings.time_offset_min || '0'}
              </div>
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>分</div>
            </div>
            <button
              onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') + 1))}
              className="w-10 h-10 rounded-lg text-lg font-bold"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >+1</button>
            <button
              onClick={() => update('time_offset_min', String(Number(settings.time_offset_min || '0') + 5))}
              className="w-12 h-12 rounded-xl text-xl font-bold"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
            >+5</button>
          </div>
          <button
            onClick={() => update('time_offset_min', '0')}
            className="w-full py-1.5 rounded-lg text-xs font-medium"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
          >リセット（±0）</button>
        </div>

        {/* Section visibility */}
        <div className="card p-4 md:col-span-2">
          <h3 className="text-sm font-bold mb-2 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <span className="mr-2">👁️</span>公開制御（セクション表示/非表示）
          </h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            OFFにしたセクションは「Coming Soon」表示になります。当日のタイミングでONに切り替えてください。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1">
            <Toggle label="🗓️ タイムテーブル" settingsKey="section_schedule_visible" />
            <Toggle label="🛍️ グッズ販売" settingsKey="section_merch_visible" />
            <Toggle label="🎬 映像データ" settingsKey="section_video_visible" />
            <Toggle label="🎵 音源" settingsKey="section_music_visible" />
            <Toggle label="⭐ 投票" settingsKey="section_vote_visible" />
            <Toggle label="📱 SNS" settingsKey="section_sns_visible" />
            <Toggle label="🎰 くじ引きセクション" settingsKey="lottery_section_visible" />
          </div>
        </div>

        {/* Lottery controls */}
        <div className="card p-4 md:col-span-2" style={{ borderColor: 'rgba(242,122,26,0.5)', borderWidth: '2px' }}>
          <h3 className="text-sm font-bold mb-2 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            <span className="mr-2">🎰</span>くじ引き運営コントロール
          </h3>
          <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
            MCの合図でON、時間が来たらOFF。キーワードはMCが当日マイクで発表する文字列。
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Toggle label="受付ON/OFF（くじ引き可能）" settingsKey="lottery_active" />
            </div>
            <Field label="キーワード（MCが当日発表）" settingsKey="lottery_keyword" />
            <Field label="景品名" settingsKey="lottery_prize_name" />
            <Field label="景品画像URL" settingsKey="lottery_prize_image" />
            <Field label="当選確率（0-1、例: 0.10 = 10%）" settingsKey="lottery_probability" />
            <Field label="当選数上限" settingsKey="lottery_winners_cap" type="number" />
          </div>
          <div className="mt-4 p-3 rounded-lg text-xs" style={{ background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
            👉 当選者一覧は <a href="/admin/lottery-winners" className="underline" style={{ color: 'var(--accent-primary)' }}>/admin/lottery-winners</a> で確認できます
          </div>
        </div>

        {/* Feature toggles */}
        <div className="card p-4">
          <h3 className="text-sm font-bold mb-4 pb-2" style={{ color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)' }}>
            機能トグル
          </h3>
          <div className="space-y-1">
            <Toggle label="投票機能" settingsKey="vote_enabled" />
            <Toggle label="音源セクション" settingsKey="music_enabled" />
            <Toggle label="グッズ販売" settingsKey="merch_enabled" />
            <Toggle label="映像販売" settingsKey="video_enabled" />
          </div>
        </div>
      </div>
    </div>
  );
}
