'use client';

// 完了画面の「カードの支払いに進む」ボタン。Stripe Checkout のURLへ移動する。
import { useState } from 'react';
import { startSpWsCheckout } from '../actions';
import { WsError, btnPrimaryCls } from '../ui';

export default function CheckoutButton({ token, amountTotal }: { token: string; amountTotal: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    const res = await startSpWsCheckout(token);
    setBusy(false);
    if (res.ok) window.location.href = res.url;
    else setError(res.error);
  }

  return (
    <div className="space-y-3">
      <button onClick={go} disabled={busy} className={`w-full rounded-full py-4 text-lg font-bold ${btnPrimaryCls}`}>
        {busy ? '接続しています…' : `カードの支払いに進む(¥${amountTotal.toLocaleString()})`}
      </button>
      {error && <WsError>{error}</WsError>}
    </div>
  );
}
