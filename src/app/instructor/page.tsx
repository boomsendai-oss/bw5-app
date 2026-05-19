'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type Instructor = { id: number; name: string };

export default function InstructorLoginPage() {
  const router = useRouter();
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [pin, setPin] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [mode, setMode] = useState<'pin' | 'birth'>('pin');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    fetch('/api/instructor/list').then(r => r.json()).then(d => setInstructors(d.instructors ?? []));
    // 既にログイン済みならdashboardへ
    fetch('/api/instructor/auth/me', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.me) router.push('/instructor/dashboard'); });
  }, [router]);

  const login = async () => {
    if (!selectedId) { setErr('名前を選択してください'); return; }
    setBusy(true); setErr(''); setInfo('');
    try {
      const body: Record<string, string | number> = { instructor_id: selectedId };
      if (mode === 'pin') body.pin = pin;
      else body.birth_date = birthDate;
      const res = await fetch('/api/instructor/auth/login', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        if (d.need_birth_date && mode === 'pin') {
          setMode('birth');
          setInfo('初回ログインです。生年月日(YYYYMMDD)を入力してください');
        } else {
          setErr(d.error ?? `HTTP ${res.status}`);
        }
        return;
      }
      if (d.setup_required) router.push('/instructor/setup');
      else router.push('/instructor/dashboard');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!selectedId) { setErr('名前を選択してください'); return; }
    if (!confirm('登録メールアドレスにPINリセットリンクを送ります。よろしいですか?')) return;
    setBusy(true);
    const res = await fetch('/api/instructor/auth/reset-request', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instructor_id: selectedId }),
    });
    setBusy(false);
    const d = await res.json();
    if (res.ok) setInfo(`${d.sent_to} にリセットメールを送りました (1時間有効)`);
    else setErr(d.error ?? 'リセット失敗');
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-6 sm:p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold text-orange-700">🎯 BOOM</h1>
          <p className="text-sm text-slate-500 mt-1">インストラクター専用ポータル</p>
        </div>

        {err && <div className="mb-3 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{err}</div>}
        {info && <div className="mb-3 p-2 rounded bg-blue-50 border border-blue-200 text-blue-700 text-sm">{info}</div>}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600">名前を選択</label>
            <select
              value={selectedId ?? ''}
              onChange={e => setSelectedId(e.target.value ? Number(e.target.value) : null)}
              className="w-full px-3 py-2 border border-slate-300 rounded mt-1 bg-white"
            >
              <option value="">-- 選択してください --</option>
              {instructors.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>

          {mode === 'pin' ? (
            <div>
              <label className="text-xs font-semibold text-slate-600">PIN (4〜6桁)</label>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value.replace(/\D/g, '').substring(0, 6))}
                className="w-full px-3 py-2 border border-slate-300 rounded mt-1 text-center text-2xl tracking-widest"
                placeholder="••••"
                autoComplete="off"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs font-semibold text-slate-600">生年月日 (YYYYMMDD)</label>
              <input
                type="text"
                inputMode="numeric"
                value={birthDate}
                onChange={e => setBirthDate(e.target.value.replace(/\D/g, '').substring(0, 8))}
                className="w-full px-3 py-2 border border-slate-300 rounded mt-1 text-center"
                placeholder="19900101"
                autoComplete="off"
              />
              <p className="text-[10px] text-slate-400 mt-1">初回ログインのみ、以降はPINで</p>
            </div>
          )}

          <button
            onClick={login}
            disabled={busy || !selectedId}
            className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded disabled:opacity-50"
          >
            {busy ? '...' : 'ログイン'}
          </button>

          <div className="flex justify-between text-xs">
            <button onClick={() => setMode(mode === 'pin' ? 'birth' : 'pin')} className="text-slate-500 hover:text-orange-600 underline">
              {mode === 'pin' ? '初回ログイン (生年月日)' : 'PINでログインに戻る'}
            </button>
            <button onClick={reset} disabled={!selectedId} className="text-slate-500 hover:text-orange-600 underline disabled:opacity-50">
              PINを忘れた
            </button>
          </div>
        </div>

        <p className="text-[10px] text-slate-400 text-center mt-6">BOOM Dance School</p>
      </div>
    </main>
  );
}
