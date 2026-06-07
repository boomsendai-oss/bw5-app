'use client';

import { useEffect } from 'react';
import { Plus } from 'lucide-react';

// ── Toast ──────────────────────────────────────────────────────────

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 2500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="fixed top-4 right-4 z-50 px-4 py-2 rounded-lg text-sm font-medium text-white"
      style={{ background: 'linear-gradient(135deg, #e07b2d, #f4a261)' }}>
      {message}
    </div>
  );
}

// ── useToast hook ──────────────────────────────────────────────────

import { useState, useCallback } from 'react';

export function useToast() {
  const [toast, setToast] = useState('');
  const notify = useCallback((msg: string) => setToast(msg), []);
  const clearToast = useCallback(() => setToast(''), []);
  return { toast, notify, clearToast };
}

// ── TabHeader ──────────────────────────────────────────────────────

export function TabHeader({ title, onAdd, addLabel }: { title: string; onAdd?: () => void; addLabel?: string }) {
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
