'use client';

import { useState, useEffect, useCallback } from 'react';
import { Save, Edit3, Trash2, X, RefreshCw, Plus, BarChart3 } from 'lucide-react';
import { Toast, useToast } from '../_components/AdminShared';
import type { VoteCandidate } from '../_components/types';

export default function AdminVotePage() {
  const { toast, notify, clearToast } = useToast();
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
      {toast && <Toast message={toast} onClose={clearToast} />}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">投票管理</h2>
        <button onClick={resetVotes} className="btn-secondary text-sm px-4 py-2 flex items-center gap-1" style={{ color: 'var(--accent-primary)' }}>
          <RefreshCw className="w-3 h-3" /> リセット
        </button>
      </div>

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
