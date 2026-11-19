'use client';

// 完了画面の「決済に進む」ボタン。Stripe Checkout のURLへ移動する。
import { useState } from 'react';
import { startBattleCheckout } from '../actions';
import { DojoError, btnPrimaryCls } from '../ui';

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
    <div className="space-y-3">
      <button onClick={go} disabled={busy} className={`w-full rounded py-4 text-lg font-black ${btnPrimaryCls}`}>
        {busy ? '接続中…' : `決済に進む(¥${amountTotal.toLocaleString()})`}
      </button>
      {error && <DojoError>{error}</DojoError>}
    </div>
  );
}
