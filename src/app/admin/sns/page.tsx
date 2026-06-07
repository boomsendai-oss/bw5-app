'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Edit3, X } from 'lucide-react';
import { TabHeader, Toast, useToast } from '../_components/AdminShared';
import type { SnsLink } from '../_components/types';

export default function AdminSnsPage() {
  const { toast, notify, clearToast } = useToast();
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
      {toast && <Toast message={toast} onClose={clearToast} />}
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
