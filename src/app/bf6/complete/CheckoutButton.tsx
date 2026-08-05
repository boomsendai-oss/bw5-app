'use client';

// 完了画面の「決済に進む」ボタン(クライアント側)。Checkout URLへ遷移する。
import { useState } from 'react';
import { startBf6Checkout } from '../actions';

export default function CheckoutButton({ token, amountTotal }: { token: string; amountTotal: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    const res = await startBf6Checkout(token);
    setBusy(false);
    if (res.ok) {
      window.location.href = res.url;
    } else {
      setError(res.error);
    }
  }

  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className="w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? '接続中…' : `決済に進む(¥${amountTotal.toLocaleString()})`}
      </button>
      {error && <p className="mt-3 rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
    </div>
  );
}
