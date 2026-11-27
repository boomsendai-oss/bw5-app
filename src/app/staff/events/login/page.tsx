'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const sp = useSearchParams();
  const next = sp.get('next') || '/staff/events';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/staff/events/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError('パスワードが違います');
      } else {
        // ページを丸ごと読み込み直す。画面の切り替えだけだと、スタッフ画面の外(例: /bf7 の下見)へ行くとき
        // ログイン前の表示が残ったり崩れたりする(2026-11-27 TARO「ログインしても正常に表示されない」)。
        // 行き先はこのサイトの中だけ(// で始まる外部URLは通さない)
        const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/staff/events';
        window.location.assign(dest);
      }
    } catch {
      setError('通信エラー');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm bg-white rounded-2xl shadow p-8 space-y-4 border border-brand-100"
      >
        <h1 className="text-xl font-bold text-brand-600">イベント運営 ログイン</h1>
        <p className="text-sm text-neutral-600">管理パスワードを入力してください。</p>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border border-neutral-300 rounded-lg px-3 py-2 text-neutral-900 bg-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
          placeholder="password"
          required
        />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-semibold rounded-lg py-2"
        >
          {loading ? '...' : 'ログイン'}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="p-8 text-neutral-500">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
