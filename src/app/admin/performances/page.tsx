'use client';

import { useState, useEffect, useCallback } from 'react';
import { ArrowLeft, Save, RefreshCw, Users, Music, Mic2, Search } from 'lucide-react';
import Link from 'next/link';

interface Performance {
  m_id: string;
  title: string;
  title_reading: string;
  instructor: string;
  instructor_photo_url: string;
  performer_count: number;
  genre: string;
  song_name: string;
  part: number;
}

const PART_COLORS: Record<number, string> = {
  1: '#f27a1a',
  2: '#60a5fa',
  3: '#a78bfa',
};

export default function PerformancesAdminPage() {
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState('');
  const [performances, setPerformances] = useState<Performance[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editData, setEditData] = useState<Performance | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [filterPart, setFilterPart] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined' && sessionStorage.getItem('bw5_admin') === '1') {
      setAuthed(true);
    }
  }, []);

  const fetchPerformances = useCallback(async () => {
    try {
      const res = await fetch('/api/performances');
      const data = await res.json();
      setPerformances(data);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    if (authed) fetchPerformances();
  }, [authed, fetchPerformances]);

  const handleLogin = async () => {
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data?.success) {
        setAuthed(true);
        sessionStorage.setItem('bw5_admin', '1');
      } else {
        setToast('パスワードが違います');
      }
    } catch {
      setToast('エラーが発生しました');
    }
  };

  const handleEdit = (perf: Performance) => {
    setEditing(perf.m_id);
    setEditData({ ...perf });
  };

  const handleSave = async () => {
    if (!editData) return;
    setSaving(true);
    try {
      await fetch('/api/performances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', ...editData }),
      });
      await fetchPerformances();
      setEditing(null);
      setEditData(null);
      setToast('保存しました');
    } catch {
      setToast('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditing(null);
    setEditData(null);
  };

  // Filter and search
  const filtered = performances.filter((p) => {
    if (filterPart !== null && p.part !== filterPart) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        p.m_id.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.instructor.toLowerCase().includes(q) ||
        p.genre.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const stats = {
    total: performances.length,
    withSong: performances.filter((p) => p.song_name).length,
    withCount: performances.filter((p) => p.performer_count > 0).length,
    withInstructor: performances.filter((p) => p.instructor).length,
  };

  if (!authed) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)] flex items-center justify-center p-4">
        <div className="w-full max-w-xs rounded-2xl p-6" style={{ background: 'rgba(255,255,255,0.95)' }}>
          <h2 className="text-lg font-bold text-center mb-4" style={{ color: '#333' }}>管理者ログイン</h2>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            placeholder="パスワード"
            className="w-full px-3 py-2.5 rounded-xl text-sm border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800 mb-3"
          />
          <button
            onClick={handleLogin}
            className="w-full py-2.5 rounded-xl text-sm font-bold text-white"
            style={{ background: '#f27a1a' }}
          >
            ログイン
          </button>
          {toast && <p className="text-xs text-red-500 mt-2 text-center">{toast}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] bg-noise text-white">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium text-white"
          style={{ background: '#f27a1a', boxShadow: '0 4px 12px rgba(0,0,0,0.2)' }}
        >
          {toast}
        </div>
      )}

      {/* Header */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'rgba(220, 100, 10, 0.85)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/admin" className="text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div className="flex-1">
            <h1 className="text-lg font-bold tracking-wider">ナンバー管理</h1>
            <p className="text-[10px] text-white/50">PERFORMANCES MASTER DATA</p>
          </div>
          <button
            onClick={fetchPerformances}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.15)' }}
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 pb-24">
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {[
            { label: '全演目', value: stats.total, icon: Music },
            { label: 'インストラクター', value: `${stats.withInstructor}/${stats.total}`, icon: Mic2 },
            { label: '出演人数', value: `${stats.withCount}/${stats.total}`, icon: Users },
            { label: '楽曲名', value: `${stats.withSong}/${stats.total}`, icon: Music },
          ].map((stat) => (
            <div
              key={stat.label}
              className="rounded-xl p-3 text-center"
              style={{ background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)' }}
            >
              <stat.icon size={16} className="mx-auto mb-1 opacity-60" />
              <div className="text-lg font-bold">{stat.value}</div>
              <div className="text-[9px] text-white/50">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="flex gap-2 mt-4 items-center">
          <div className="flex gap-1.5 flex-1">
            <button
              onClick={() => setFilterPart(null)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
              style={{
                background: filterPart === null ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.1)',
                color: filterPart === null ? '#f27a1a' : 'rgba(255,255,255,0.6)',
              }}
            >
              全部
            </button>
            {[1, 2, 3].map((part) => (
              <button
                key={part}
                onClick={() => setFilterPart(filterPart === part ? null : part)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold transition-all"
                style={{
                  background: filterPart === part ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.1)',
                  color: filterPart === part ? PART_COLORS[part] : 'rgba(255,255,255,0.6)',
                }}
              >
                {part}部
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="検索..."
              className="pl-8 pr-3 py-1.5 rounded-lg text-xs bg-white/10 border border-white/15 text-white placeholder:text-white/30 focus:outline-none focus:border-white/30"
              style={{ width: '140px' }}
            />
          </div>
        </div>

        {/* Performance List */}
        <div className="mt-4 space-y-1.5">
          {filtered.map((perf) => {
            const isEditing = editing === perf.m_id;

            if (isEditing && editData) {
              return (
                <div
                  key={perf.m_id}
                  className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid rgba(255,255,255,0.8)' }}
                >
                  {/* Edit Form */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                      style={{ background: PART_COLORS[editData.part] }}
                    >
                      {editData.m_id}
                    </span>
                    <span className="text-sm font-bold" style={{ color: '#333' }}>{editData.title}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold mb-1 block" style={{ color: '#999' }}>インストラクター</label>
                      <input
                        type="text"
                        value={editData.instructor}
                        onChange={(e) => setEditData({ ...editData, instructor: e.target.value })}
                        className="w-full px-2.5 py-2 rounded-lg text-xs border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold mb-1 block" style={{ color: '#999' }}>ジャンル</label>
                      <input
                        type="text"
                        value={editData.genre}
                        onChange={(e) => setEditData({ ...editData, genre: e.target.value })}
                        className="w-full px-2.5 py-2 rounded-lg text-xs border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold mb-1 block" style={{ color: '#999' }}>楽曲名</label>
                      <input
                        type="text"
                        value={editData.song_name}
                        onChange={(e) => setEditData({ ...editData, song_name: e.target.value })}
                        className="w-full px-2.5 py-2 rounded-lg text-xs border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold mb-1 block" style={{ color: '#999' }}>出演人数</label>
                      <input
                        type="number"
                        value={editData.performer_count}
                        onChange={(e) => setEditData({ ...editData, performer_count: parseInt(e.target.value) || 0 })}
                        className="w-full px-2.5 py-2 rounded-lg text-xs border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold mb-1 block" style={{ color: '#999' }}>タイトル読み</label>
                      <input
                        type="text"
                        value={editData.title_reading}
                        onChange={(e) => setEditData({ ...editData, title_reading: e.target.value })}
                        className="w-full px-2.5 py-2 rounded-lg text-xs border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold mb-1 block" style={{ color: '#999' }}>インストラクター写真URL</label>
                      <input
                        type="text"
                        value={editData.instructor_photo_url}
                        onChange={(e) => setEditData({ ...editData, instructor_photo_url: e.target.value })}
                        className="w-full px-2.5 py-2 rounded-lg text-xs border border-gray-200 focus:border-orange-400 focus:outline-none text-gray-800"
                        placeholder="/images/instructors/..."
                      />
                    </div>
                  </div>

                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={handleCancel}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{ background: '#f0f0f0', color: '#999' }}
                    >
                      キャンセル
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg text-xs font-bold text-white flex items-center justify-center gap-1.5"
                      style={{ background: '#f27a1a' }}
                    >
                      <Save size={12} />
                      {saving ? '保存中...' : '保存'}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <button
                key={perf.m_id}
                onClick={() => handleEdit(perf)}
                className="w-full text-left rounded-xl px-4 py-3 flex items-center gap-3 transition-all hover:scale-[1.01]"
                style={{
                  background: 'rgba(255,255,255,0.12)',
                  border: '1px solid rgba(255,255,255,0.12)',
                }}
              >
                {/* M-ID badge */}
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white shrink-0"
                  style={{ background: PART_COLORS[perf.part] || '#999' }}
                >
                  {perf.m_id}
                </span>

                {/* Title & Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-white truncate">{perf.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {perf.instructor && (
                      <span className="text-[10px] text-white/50">{perf.instructor}</span>
                    )}
                    {perf.genre && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full text-white/60"
                        style={{ background: 'rgba(255,255,255,0.08)' }}
                      >
                        {perf.genre}
                      </span>
                    )}
                  </div>
                </div>

                {/* Data completeness indicators */}
                <div className="flex gap-1 shrink-0">
                  {perf.performer_count > 0 && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                      style={{ background: 'rgba(34,197,94,0.2)', color: '#22c55e' }}
                    >
                      {perf.performer_count}
                    </span>
                  )}
                  {perf.song_name && (
                    <span className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'rgba(59,130,246,0.2)' }}
                    >
                      <Music size={10} style={{ color: '#3b82f6' }} />
                    </span>
                  )}
                  {!perf.instructor && !perf.song_name && perf.performer_count === 0 && (
                    <span className="text-[9px] text-white/30">未入力</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-white/40">
            <Music className="mx-auto mb-3 opacity-30" size={32} />
            <p className="text-sm">該当する演目がありません</p>
          </div>
        )}
      </main>
    </div>
  );
}
