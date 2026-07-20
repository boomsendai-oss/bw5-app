'use client';

import { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Calendar, ShoppingBag, Music, Video, Vote, Share2, Package, Settings,
  LogOut, X
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

/**
 * M24: 認証を eventAuth のセッションCookieへ統合。
 *
 * 旧実装は sessionStorage('bw5_admin') を見るだけのクライアント側フラグで、
 * DevToolsで1行セットすれば管理画面が開けた(=実質ノーガード)。現在は proxy.ts の
 * matcher に /admin・/api/admin を入れてサーバ側で弾き、未ログインは
 * /staff/events/login へリダイレクトされる。したがってこのコンポーネントに
 * ログイン画面は不要(ここに描画が到達している時点で認証済み)。
 */
export default function AdminLayoutClient({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const pathname = usePathname();

  const handleLogout = useCallback(async () => {
    // セッションCookieはhttpOnlyなのでサーバ側で失効させる(DBのadmin_sessionsからも削除)
    await fetch('/api/staff/events/login', { method: 'DELETE' }).catch(() => {});
    window.location.href = '/staff/events/login?next=/admin';
  }, []);

  // Determine active tab from pathname
  const activeTabId = TABS.find(t => pathname.startsWith(t.href))?.id || '';

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
