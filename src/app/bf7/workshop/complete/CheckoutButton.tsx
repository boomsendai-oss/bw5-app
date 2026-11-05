'use client';

// 完了画面の「決済に進む」ボタン。Stripeの決済画面へ移動する。
import { useState } from 'react';
import { startBf7WsCheckout } from '../actions';
import { btnPrimaryCls } from '../../ui';

export default function CheckoutButton({ token, amountTotal }: { token: string; amountTotal: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    const res = await startBf7WsCheckout(token);
    if (res.ok) {
      window.location.href = res.url;
      return;
    }
    setBusy(false);
    setError(res.error);
  }

  return (
    <div>
      <button onClick={go} disabled={busy} className={`w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50 ${btnPrimaryCls}`}>
        {busy ? '接続中…' : `決済に進む(¥${amountTotal.toLocaleString()})`}
      </button>
      {error && <p className="mt-3 rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
    </div>
  );
}
