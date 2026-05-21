'use client';

import { useCallback, useEffect, useState, use as usePromise } from 'react';
import Link from 'next/link';

type Todo = {
  id: number;
  event_id: number;
  category: string | null;
  fact: string | null;
  cause: string | null;
  action: string;
  assignee: string | null;
  priority: string | null;
  due_period: string | null;
  status: string;
  created_at: string;
};

const STATUSES = ['open', 'in_progress', 'done'] as const;
const PRIORITIES = ['高', '中', '低'];
const DUE_PERIODS = ['今月', '3ヶ月以内', '直前'];
const ASSIGNEES = ['TARO', 'KEIKO', 'Claude', '外部'];

export default function TodoPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = usePromise(params);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'open' | 'in_progress' | 'done'>('all');
  const [form, setForm] = useState({
    category: '',
    fact: '',
    cause: '',
    action: '',
    assignee: '',
    priority: '',
    due_period: '',
  });

  const load = useCallback(async () => {
    const res = await fetch(`/api/staff/events/${eventId}/todos`, { credentials: 'include' });
    if (res.status === 401) {
      window.location.href = `/staff/events/login?next=/staff/events/${eventId}/todo`;
      return;
    }
    const data = await res.json();
    setTodos(data.todos ?? []);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addTodo(e: React.FormEvent) {
    e.preventDefault();
    if (!form.action.trim()) return;
    const res = await fetch(`/api/staff/events/${eventId}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(form),
    });
    if (res.ok) {
      setForm({ category: '', fact: '', cause: '', action: '', assignee: '', priority: '', due_period: '' });
      load();
    }
  }

  async function patch(todo: Todo, patchBody: Partial<Todo>) {
    await fetch(`/api/staff/events/${eventId}/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(patchBody),
    });
    load();
  }

  async function remove(todo: Todo) {
    if (!confirm('削除しますか？')) return;
    await fetch(`/api/staff/events/${eventId}/todos/${todo.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    load();
  }

  const filtered = filter === 'all' ? todos : todos.filter((t) => t.status === filter);

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-orange-100 px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <Link href={`/staff/events/${eventId}`} className="text-xs text-orange-600 hover:underline">
            ← ダッシュボード
          </Link>
          <h1 className="text-xl font-bold text-orange-600 mt-1">ToDo リスト</h1>
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6 space-y-4">
        {/* 追加フォーム */}
        <form onSubmit={addTodo} className="bg-white rounded-2xl border border-orange-100 p-5 space-y-3 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Field label="カテゴリ">
              <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5" placeholder="体制/演出/当日オペ" />
            </Field>
            <Field label="担当">
              <select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5">
                <option value="">未定</option>
                {ASSIGNEES.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
            <Field label="優先度">
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5">
                <option value="">未設定</option>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </Field>
            <Field label="期限">
              <select value={form.due_period} onChange={(e) => setForm({ ...form, due_period: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5">
                <option value="">未設定</option>
                {DUE_PERIODS.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="事実 (何が)">
              <input value={form.fact} onChange={(e) => setForm({ ...form, fact: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5" />
            </Field>
            <Field label="原因 (なぜ)">
              <input value={form.cause} onChange={(e) => setForm({ ...form, cause: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5" />
            </Field>
            <Field label="アクション ※必須">
              <input required value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className="w-full border border-neutral-300 rounded px-2 py-1.5" />
            </Field>
          </div>
          <button type="submit" className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold rounded-lg px-4 py-2">
            ＋ 追加
          </button>
        </form>

        {/* フィルタ */}
        <div className="flex gap-2 text-sm">
          {(['all', ...STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`px-3 py-1 rounded-full border ${
                filter === s
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white text-neutral-700 border-neutral-300'
              }`}
            >
              {s === 'all' ? 'すべて' : s}
            </button>
          ))}
        </div>

        {/* リスト */}
        {loading ? (
          <div className="text-neutral-500">読み込み中…</div>
        ) : filtered.length === 0 ? (
          <div className="text-neutral-500 bg-white rounded-2xl border border-orange-100 p-8 text-center">
            ToDo がありません。
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((t) => (
              <li key={t.id} className="bg-white rounded-2xl border border-orange-100 p-4">
                <div className="flex items-start gap-3">
                  <select
                    value={t.status}
                    onChange={(e) => patch(t, { status: e.target.value })}
                    className="text-xs border border-neutral-300 rounded px-1.5 py-1"
                  >
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold">{t.action}</div>
                    {(t.fact || t.cause) && (
                      <div className="text-xs text-neutral-500 mt-1">
                        {t.fact && <>事実: {t.fact}　</>}
                        {t.cause && <>原因: {t.cause}</>}
                      </div>
                    )}
                    <div className="text-xs text-neutral-600 mt-1 flex flex-wrap gap-2">
                      {t.category && <span className="bg-orange-50 text-orange-700 px-2 py-0.5 rounded">{t.category}</span>}
                      {t.assignee && <span className="bg-neutral-100 px-2 py-0.5 rounded">{t.assignee}</span>}
                      {t.priority && <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded">優先度:{t.priority}</span>}
                      {t.due_period && <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{t.due_period}</span>}
                    </div>
                  </div>
                  <button onClick={() => remove(t)} className="text-xs text-red-600 hover:underline">削除</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs text-neutral-600">{label}</span>
      {children}
    </label>
  );
}
