'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';

type EventRow = {
  id: number;
  code: string;
  name: string;
  event_date: string | null;
  status: string;
  created_at: string;
};

export default function EventsListPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', event_date: '', status: 'planning' });
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/staff/events', { credentials: 'include' });
      if (res.status === 401) {
        window.location.href = '/staff/events/login?next=/staff/events';
        return;
      }
      const data = await res.json();
      setEvents(data.events ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/staff/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        code: form.code.trim(),
        name: form.name.trim(),
        event_date: form.event_date || null,
        status: form.status,
      }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error ?? '作成失敗');
      return;
    }
    setForm({ code: '', name: '', event_date: '', status: 'planning' });
    setShowForm(false);
    load();
  }

  return (
    <main className="min-h-screen bg-neutral-50">
      <StaffPageHeader
        title="🎪 イベント管理"
        description="BW5・発表会等のイベント設定・タスク"
        rightExtra={
          <button
            onClick={() => setShowForm((v) => !v)}
            className="bg-orange-500 hover:bg-orange-600 text-white text-xs sm:text-sm font-semibold rounded-lg px-3 py-1.5"
          >
            {showForm ? 'キャンセル' : '＋ 新規イベント'}
          </button>
        }
      />

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        {showForm && (
          <form onSubmit={create} className="bg-white rounded-2xl border border-orange-100 p-5 space-y-3 shadow-sm">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs text-neutral-600">コード (例: BW6)</span>
                <input
                  required
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600">名称</span>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600">開催日</span>
                <input
                  type="date"
                  value={form.event_date}
                  onChange={(e) => setForm({ ...form, event_date: e.target.value })}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5"
                />
              </label>
              <label className="block">
                <span className="text-xs text-neutral-600">ステータス</span>
                <select
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                  className="w-full border border-neutral-300 rounded px-2 py-1.5"
                >
                  <option value="planning">planning</option>
                  <option value="preparing">preparing</option>
                  <option value="live">live</option>
                  <option value="closed">closed</option>
                </select>
              </label>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <button
              type="submit"
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg px-4 py-2"
            >
              作成
            </button>
          </form>
        )}

        {loading ? (
          <div className="text-neutral-500">読み込み中…</div>
        ) : events.length === 0 ? (
          <div className="text-neutral-500 bg-white rounded-2xl border border-orange-100 p-8 text-center">
            まだイベントがありません。「＋ 新規イベント」から作成してください。
          </div>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id}>
                <Link
                  href={`/staff/events/${ev.id}`}
                  className="block bg-white rounded-2xl border border-orange-100 p-4 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-orange-600 font-mono">{ev.code}</div>
                      <div className="font-semibold">{ev.name}</div>
                      <div className="text-xs text-neutral-500">
                        {ev.event_date ?? '日付未定'} ・ {ev.status}
                      </div>
                    </div>
                    <div className="text-orange-500">→</div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
