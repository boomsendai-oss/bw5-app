'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

type Instructor = { id: number; name: string };

export default function InstructorCancelPage() {
  const router = useRouter();
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [form, setForm] = useState({ lesson_date: '', reason: '', substitute_instructor_id: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/instructor/auth/me', { credentials: 'include' }).then(r => {
      if (r.status === 401) router.push('/instructor');
    });
    fetch('/api/instructor/list').then(r => r.json()).then(d => setInstructors(d.instructors ?? []));
  }, [router]);

  const submit = async () => {
    setErr(''); setMsg('');
    if (!form.lesson_date || !form.reason) { setErr('日付と理由は必須'); return; }
    setBusy(true);
    const res = await fetch('/api/instructor/cancel-request', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lesson_date: form.lesson_date,
        reason: form.reason,
        substitute_instructor_id: form.substitute_instructor_id ? Number(form.substitute_instructor_id) : null,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setMsg('休講申請を送信しました。TAROに通知が届きます。');
      setForm({ lesson_date: '', reason: '', substitute_instructor_id: '' });
    } else {
      setErr((await res.json()).error ?? `HTTP ${res.status}`);
    }
  };

  return (
    <main className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-orange-100 px-4 py-3 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Link href="/instructor/dashboard" className="text-sm text-slate-500 hover:text-orange-600">← 戻る</Link>
          <h1 className="font-bold text-orange-600">🚫 休講申請</h1>
          <span></span>
        </div>
      </header>

      <div className="max-w-2xl mx-auto p-4">
        <div className="bg-white rounded-lg border p-4 sm:p-6">
          {msg && <div className="mb-3 p-2 rounded bg-green-50 border border-green-200 text-green-800 text-sm">{msg}</div>}
          {err && <div className="mb-3 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{err}</div>}

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-slate-600">休講するレッスン日</label>
              <input type="date" value={form.lesson_date} onChange={e => setForm({ ...form, lesson_date: e.target.value })} className="w-full px-3 py-2 border rounded mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">理由</label>
              <textarea value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} className="w-full px-3 py-2 border rounded mt-1 h-24" placeholder="体調不良 / 私用 / 等" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">代講予定 (任意)</label>
              <select value={form.substitute_instructor_id} onChange={e => setForm({ ...form, substitute_instructor_id: e.target.value })} className="w-full px-3 py-2 border rounded mt-1 bg-white">
                <option value="">-- 代講なし (TARO/KEIKOで調整) --</option>
                {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
            <button onClick={submit} disabled={busy} className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded disabled:opacity-50">
              {busy ? '送信中...' : '休講申請を送信'}
            </button>
            <p className="text-[10px] text-slate-400">
              ※ 送信後、TAROに通知メールが届きます。緊急時は別途LINEでも連絡を。
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
