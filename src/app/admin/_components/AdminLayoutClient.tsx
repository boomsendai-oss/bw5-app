'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar, ShoppingBag, Music, Video, Vote, Share2, Package, Settings,
  Lock, Eye, EyeOff, LogOut, X
} from 'lucide-react';

const TABS = [
  { id: 'schedule', label: 'スケジュール', icon: Calendar, href: '/admin/schedule' },
  { id: 'merch', label: 'グッズ', icon: ShoppingBag, href: '/admin/merch' },
  { id: 'music', label: '音源', icon: Music, href: '/admin/music' },
  { id: 'video', label: '映像', icon: Video, href: '/admin/video' },
  { id: 'vote', label: '投票', icon: Vote, href: '/admin/vote' },
  { id: 'sns', label: 'SNS', icon: Share2, href: '/admin/sns' },
  { id: 'orders', label: '注文', icon: Package, href: '/admin/orders' },
  { id: 'settings', label: '設定', icon: Settings, href: '/admin/settings' },
];

export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  // Check sessionStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('bw5_admin') === '1') {
      setAuthed(true);
    }
  }, []);

  const handleLogin = useCallback(async () => {
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
  }, [password]);

  const handleLogout = useCallback(() => {
    sessionStorage.removeItem('bw5_admin');
    setAuthed(false);
    setPassword('');
  }, []);

  // Determine active tab from pathname
  const activeTabId = TABS.find(t => pathname.startsWith(t.href))?.id || '';

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
            const active = tab.id === activeTabId;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                onClick={() => setSidebarOpen(false)}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm transition-colors"
                style={{
                  background: active ? 'var(--bg-hover)' : 'transparent',
                  color: active ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  borderRight: active ? '2px solid var(--accent-primary)' : '2px solid transparent',
                }}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
          <Link
            href="/admin/performances"
            className="flex items-center gap-2 text-sm w-full mb-3 px-4 py-2 rounded-lg transition-colors"
            style={{ background: 'var(--bg-hover)', color: 'var(--accent-primary)' }}
          >
            <Music className="w-4 h-4" /> ナンバー管理
          </Link>
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
          {children}
        </div>
      </main>
    </div>
  );
}
