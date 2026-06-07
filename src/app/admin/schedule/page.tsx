'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Edit3, X, Trash2 } from 'lucide-react';
import { Toast, useToast, TabHeader } from '../_components/AdminShared';
import type { ScheduleItem } from '../_components/types';

export default function SchedulePage() {
  const { toast, notify, clearToast } = useToast();
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
      {toast && <Toast message={toast} onClose={clearToast} />}
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
