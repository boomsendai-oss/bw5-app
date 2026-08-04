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
        className="w-full rounded-2xl bg-red-600 py-4 text-lg font-black text-white shadow-lg shadow-red-600/30 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? '接続中…' : `決済に進む(¥${amountTotal.toLocaleString()})`}
      </button>
      {error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-600">{error}</p>}
    </div>
  );
}
