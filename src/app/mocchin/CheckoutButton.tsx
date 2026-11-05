'use client';

// カードの決済画面へ進むボタン。金額はサーバ側で申込から組み立てる。
import { useState } from 'react';
import { startMocchinCheckout } from './actions';
import { Notice, btnCls } from './ui';

export default function CheckoutButton({ token, label }: { token: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function go() {
    setBusy(true);
    setError('');
    const r = await startMocchinCheckout(token);
    if (r.ok) {
      window.location.href = r.url;
      return;
    }
    setBusy(false);
    setError(r.error);
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="button" className={`${btnCls} mt-3`} disabled={busy} onClick={go}>
        {busy ? '決済画面を準備中…' : label}
      </button>
    </>
  );
}
