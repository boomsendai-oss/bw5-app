'use client';

// 申込1件のスタッフ操作: 取消 / 返金済み / 元に戻す / メモ。
// 確認ダイアログ(confirm)は使わず、2段階ボタンで誤操作を防ぐ。
import { useState, useTransition } from 'react';
import { setXmasNote, setXmasOrderStatus } from './actions';

export default function OrderActions({ id, status, note }: { id: number; status: string; note: string }) {
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState<'' | 'canceled' | 'refunded'>('');
  const [memo, setMemo] = useState(note);
  const [error, setError] = useState('');

  function run(action: 'canceled' | 'refunded' | 'restore') {
    setError('');
    start(async () => {
      const r = await setXmasOrderStatus(id, action);
      if (!r.ok) setError(r.error);
      setArmed('');
    });
  }

  const canCancel = ['paid', 'cash_due', 'pending', 'expired'].includes(status);
  const canRefund = status === 'paid' || status === 'canceled';

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {canCancel && (
        <button
          type="button"
          disabled={pending}
          onClick={() => (armed === 'canceled' ? run('canceled') : setArmed('canceled'))}
          className={`rounded border px-2 py-1 font-semibold ${armed === 'canceled' ? 'border-red-600 bg-red-600 text-white' : 'border-neutral-300 bg-white text-neutral-700'}`}
        >
          {armed === 'canceled' ? 'もう一度押すと取消' : '取消'}
        </button>
      )}
      {canRefund && (
        <button
          type="button"
          disabled={pending}
          onClick={() => (armed === 'refunded' ? run('refunded') : setArmed('refunded'))}
          className={`rounded border px-2 py-1 font-semibold ${armed === 'refunded' ? 'border-red-600 bg-red-600 text-white' : 'border-neutral-300 bg-white text-neutral-700'}`}
        >
          {armed === 'refunded' ? 'Stripeで返金済みならもう一度' : '返金済みにする'}
        </button>
      )}
      {status === 'canceled' && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run('restore')}
          className="rounded border border-neutral-300 bg-white px-2 py-1 font-semibold text-neutral-700"
        >
          取消を元に戻す
        </button>
      )}
      <input
        value={memo}
        onChange={(e) => setMemo(e.target.value)}
        onBlur={() => memo !== note && start(async () => void (await setXmasNote(id, memo)))}
        placeholder="メモ(返金の理由など)"
        className="min-w-48 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400"
      />
      {error && <span className="font-semibold text-red-600">{error}</span>}
    </div>
  );
}
