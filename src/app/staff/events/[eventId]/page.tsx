'use client';

import { useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';

type EventRow = {
  id: number;
  code: string;
  name: string;
  event_date: string | null;
  status: string;
};

type TodoSummary = { total: number; open: number; in_progress: number; done: number };

export default function EventDashboard({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [event, setEvent] = useState<EventRow | null>(null);
  const [summary, setSummary] = useState<TodoSummary>({ total: 0, open: 0, in_progress: 0, done: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [evRes, todosRes] = await Promise.all([
          fetch(`/api/staff/events/${eventId}`, { credentials: 'include' }),
          fetch(`/api/staff/events/${eventId}/todos`, { credentials: 'include' }),
        ]);
        if (evRes.status === 401) {
          window.location.href = `/staff/events/login?next=/staff/events/${eventId}`;
          return;
        }
        const evJson = await evRes.json();
        const todosJson = await todosRes.json();
        setEvent(evJson.event);
        const todos = todosJson.todos ?? [];
        const s: TodoSummary = { total: todos.length, open: 0, in_progress: 0, done: 0 };
        for (const t of todos) {
          if (t.status === 'open') s.open++;
          else if (t.status === 'in_progress') s.in_progress++;
          else if (t.status === 'done') s.done++;
        }
        setSummary(s);
      } finally {
        setLoading(false);
      }
    })();
  }, [eventId]);

  if (loading) return <div className="p-8 text-neutral-500">読み込み中…</div>;
  if (!event) return <div className="p-8 text-red-600">イベントが見つかりません</div>;

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-orange-100 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <Link href="/staff/events" className="text-xs text-orange-600 hover:underline">
              ← 一覧へ
            </Link>
            <h1 className="text-xl font-bold text-orange-600 mt-1">
              {event.code} <span className="text-neutral-800">{event.name}</span>
            </h1>
            <div className="text-xs text-neutral-500">
              {event.event_date ?? '日付未定'} ・ {event.status}
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <section className="grid grid-cols-4 gap-3">
          <SummaryCard label="ToDo 合計" value={summary.total} />
          <SummaryCard label="未着手" value={summary.open} color="text-red-600" />
          <SummaryCard label="進行中" value={summary.in_progress} color="text-orange-600" />
          <SummaryCard label="完了" value={summary.done} color="text-emerald-600" />
        </section>

        <nav className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NavCard href={`/staff/events/${eventId}/todo`} title="ToDo リスト" desc="反省/準備 ToDo を管理" />
          <NavCard href={`#`} title="スタッフ管理" desc="（Phase 2 で実装）" disabled />
          <NavCard href={`#`} title="タイムテーブル" desc="（Phase 2 で実装）" disabled />
          <NavCard href={`#`} title="収支" desc="（Phase 2 で実装）" disabled />
        </nav>
      </div>
    </main>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-orange-100 p-3 text-center">
      <div className={`text-2xl font-bold ${color ?? 'text-neutral-800'}`}>{value}</div>
      <div className="text-xs text-neutral-500 mt-1">{label}</div>
    </div>
  );
}

function NavCard({
  href,
  title,
  desc,
  disabled,
}: {
  href: string;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  if (disabled) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 opacity-50 cursor-not-allowed">
        <div className="font-semibold text-neutral-700">{title}</div>
        <div className="text-xs text-neutral-500 mt-1">{desc}</div>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="bg-white rounded-2xl border border-orange-100 p-4 hover:shadow-md transition block"
    >
      <div className="font-semibold text-orange-600">{title}</div>
      <div className="text-xs text-neutral-500 mt-1">{desc}</div>
    </Link>
  );
}
