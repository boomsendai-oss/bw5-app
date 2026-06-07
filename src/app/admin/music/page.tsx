'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Edit3, Trash2, X, ChevronDown, ChevronUp } from 'lucide-react';
import { TabHeader, Toast, useToast } from '../_components/AdminShared';
import type { MusicRelease } from '../_components/types';

export default function AdminMusicPage() {
  const { toast, notify, clearToast } = useToast();
  const [items, setItems] = useState<MusicRelease[]>([]);
  const [editId, setEditId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const emptyForm = { artist: '', title: '', jacket_url: '', apple_music_url: '', spotify_url: '', amazon_music_url: '', youtube_music_url: '', release_at: '' };
  const [form, setForm] = useState(emptyForm);

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

  const FormFields = () => (
    <>
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
    </>
  );

  return (
    <div>
      {toast && <Toast message={toast} onClose={clearToast} />}
      <TabHeader title="音源管理" onAdd={() => { setAdding(true); setForm(emptyForm); }} />

      {adding && (
        <div className="card p-4 mb-4">
          <FormFields />
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
                <FormFields />
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
