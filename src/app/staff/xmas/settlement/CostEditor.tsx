'use client';

// 支出(会場費以外: プレゼント・賞品など)の手入力。会場費は精算で自動記録される。
import { useState, useTransition } from 'react';
import { yen } from '@/lib/party';
import { addXmasCost, deleteXmasLedger } from '../actions';

const inputCls =
  'w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none';

interface CostEntry {
  id: number;
  label: string;
  amount: number;
  note: string;
  category: string;
}

export default function CostEditor({ entries }: { entries: CostEntry[] }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(0);
  const [staff, setStaff] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState('');

  function add() {
    setError('');
    start(async () => {
      const r = await addXmasCost({ label, amount, staffName: staff });
      if (!r.ok) setError(r.error);
      else {
        setLabel('');
        setAmount(0);
      }
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-sand-200 bg-white p-4">
      <h2 className="text-sm font-bold text-navy-800">支出</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-neutral-500">まだありません</p>
      ) : (
        <ul className="divide-y divide-sand-100 text-sm text-navy-800">
          {entries.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                {e.label}
                <span className="block text-xs text-neutral-500">{e.note}</span>
              </span>
              <span className="flex items-center gap-2">
                <b>{yen(e.amount)}</b>
                {e.category !== '会場費' && (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => start(async () => void (await deleteXmasLedger(e.id)))}
                    className="rounded border border-neutral-300 px-2 py-0.5 text-xs text-neutral-600"
                  >
                    削除
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
        <input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="内容(例: プレゼント購入)" />
        <input className={inputCls} type="number" min={0} inputMode="numeric" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
        <input className={inputCls} value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="入力した人" />
        <button type="button" onClick={add} disabled={pending} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
          追加
        </button>
      </div>
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
    </section>
  );
}
