'use client';

// 完了画面の「決済に進む」ボタン。Stripe Checkout のURLへ移動する。
import { useState } from 'react';
import { startBattleCheckout } from '../actions';
import { btnPrimaryCls } from '../ui';

export default function CheckoutButton({ token, amountTotal }: { token: string; amountTotal: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    const res = await startBattleCheckout(token);
    setBusy(false);
    if (res.ok) window.location.href = res.url;
    else setError(res.error);
  }

  return (
    <div>
      <button onClick={go} disabled={busy} className={`w-full rounded-2xl py-4 text-lg font-black ${btnPrimaryCls}`}>
        {busy ? '接続中…' : `決済に進む(¥${amountTotal.toLocaleString()})`}
      </button>
      {error && <p className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm font-bold text-red-300">{error}</p>}
    </div>
  );
}
