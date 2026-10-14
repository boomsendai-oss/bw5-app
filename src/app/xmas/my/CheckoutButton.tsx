'use client';

// 控えページの「カード決済に進む」。Checkout URL はサーバがDBの注文から作る。
import { useState } from 'react';
import { yen } from '@/lib/party';
import { startXmasCheckout } from '../actions';
import { Notice, primaryBtnCls } from '../ui';

export default function CheckoutButton({ token, amountTotal }: { token: string; amountTotal: number }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    const r = await startXmasCheckout(token);
    if (r.ok) {
      window.location.href = r.url;
      return;
    }
    setBusy(false);
    setError(r.error);
  }

  return (
    <div>
      <button type="button" onClick={go} disabled={busy} className={primaryBtnCls}>
        {busy ? '接続中…' : `カード決済に進む(${yen(amountTotal)})`}
      </button>
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
