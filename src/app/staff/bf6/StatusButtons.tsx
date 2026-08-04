'use client';

// 注文の手動ステータス変更(当日現金の入金確認・キャンセル等)。スタッフ画面専用。
import { useState, useTransition } from 'react';
import { staffSetOrderStatus } from './actions';

const LABELS: Record<string, string> = {
  paid: '入金済みにする',
  cash_due: '当日現金に戻す',
  canceled: 'キャンセル',
  refunded: '返金済みにする',
};

export default function StatusButtons({ orderId, current }: { orderId: number; current: string }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState('');

  const choices = Object.keys(LABELS).filter((s) => s !== current);
  return (
    <span className="flex flex-wrap gap-1.5">
      {choices.map((s) =>
        confirming === s ? (
          <span key={s} className="flex items-center gap-1">
            <button
              disabled={pending}
              onClick={() => startTransition(async () => { await staffSetOrderStatus(orderId, s); setConfirming(''); })}
              className="rounded bg-red-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
            >
              {pending ? '…' : `${LABELS[s]}を確定`}
            </button>
            <button onClick={() => setConfirming('')} className="rounded border border-sand-300 px-2 py-1 text-xs text-neutral-500">
              やめる
            </button>
          </span>
        ) : (
          <button
            key={s}
            disabled={pending}
            onClick={() => setConfirming(s)}
            className="rounded border border-sand-300 px-2 py-1 text-xs text-navy-700 hover:bg-sand-50 disabled:opacity-50"
          >
            {LABELS[s]}
          </button>
        )
      )}
    </span>
  );
}
