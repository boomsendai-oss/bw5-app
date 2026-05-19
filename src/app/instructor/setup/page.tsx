'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function InstructorSetupPage() {
  const router = useRouter();
  const [me, setMe] = useState<{ id: number; name: string; contact_email: string | null } | null>(null);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/instructor/auth/me', { credentials: 'include' }).then(r => r.json()).then(d => {
      if (d.me) {
        setMe(d.me);
        setEmail(d.me.contact_email ?? '');
      } else {
        router.push('/instructor');
      }
    });
  }, [router]);

  const submit = async () => {
    setErr('');
    if (!/^\d{4,6}$/.test(pin)) { setErr('PIN は 4〜6桁の数字'); return; }
    if (pin !== pinConfirm) { setErr('PINが一致しません'); return; }
    if (!email) { setErr('メールアドレスを入力(PIN忘れ対応に必要)'); return; }
    setBusy(true);
    const res = await fetch('/api/instructor/auth/setup-pin', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, contact_email: email, contact_phone: phone || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      router.push('/instructor/dashboard');
    } else {
      setErr((await res.json()).error ?? `HTTP ${res.status}`);
    }
  };

  if (!me) return <main className="min-h-screen flex items-center justify-center"><p>読込中...</p></main>;

  return (
    <main className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg max-w-md w-full p-6 sm:p-8">
        <h1 className="text-xl font-bold text-orange-700">初回セットアップ</h1>
        <p className="text-sm text-slate-500 mb-6">{me.name} さん、PINとメールアドレスを設定してください</p>

        {err && <div className="mb-3 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{err}</div>}

        <div className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-slate-600">新しいPIN (4〜6桁)</label>
            <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').substring(0, 6))}
              className="w-full px-3 py-2 border rounded mt-1 text-center text-2xl tracking-widest" placeholder="••••" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">PIN (確認)</label>
            <input type="password" inputMode="numeric" value={pinConfirm} onChange={e => setPinConfirm(e.target.value.replace(/\D/g, '').substring(0, 6))}
              className="w-full px-3 py-2 border rounded mt-1 text-center text-2xl tracking-widest" placeholder="••••" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">メールアドレス (必須)</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded mt-1" placeholder="example@gmail.com" />
            <p className="text-[10px] text-slate-400 mt-1">PIN忘れ時のリセットメール送信先</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">電話番号 (任意)</label>
            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
              className="w-full px-3 py-2 border rounded mt-1" placeholder="090-0000-0000" />
          </div>
          <button onClick={submit} disabled={busy} className="w-full py-2.5 bg-orange-500 hover:bg-orange-600 text-white font-semibold rounded disabled:opacity-50">
            {busy ? '...' : '設定する'}
          </button>
        </div>
      </div>
    </main>
  );
}
