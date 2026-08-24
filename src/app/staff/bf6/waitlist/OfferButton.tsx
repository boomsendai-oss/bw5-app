'use client';

// 繰り上げ通知は自動送信にしない(TARO 2026-08-25)。
// キャンセルの事情によっては繰り上げないほうがよい場合があるため、必ず人が押す。
import { useState, useTransition } from 'react';
import { staffExpireStaleOffers, staffOfferNextWaitlist } from '../actions';

export function OfferButton({ division, label, waiting }: { division: string; label: string; waiting: number }) {
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (waiting === 0) {
    return <p className="rounded-xl bg-neutral-100 p-3 text-xs font-bold text-neutral-500">待機中の方はいません</p>;
  }
  if (msg) return <p className="rounded-xl bg-brand-50 p-3 text-sm font-bold text-brand-700">{msg}</p>;

  return !armed ? (
    <button onClick={() => setArmed(true)} className="w-full rounded-xl bg-brand-600 py-3 font-black text-white">
      {label}の次の方に繰り上げを通知する
    </button>
  ) : (
    <div className="space-y-2 rounded-xl border-2 border-red-500 bg-red-50 p-3">
      <p className="text-xs font-black text-red-700">
        先頭の方に繰り上げのご案内メールを送ります。送信後は取り消せません。
      </p>
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await staffOfferNextWaitlist(division);
            setMsg(r.ok ? `${r.dancerName} さん(${r.email})にご案内を送りました` : r.error);
          })
        }
        className="w-full rounded-xl bg-red-600 py-3 font-black text-white disabled:opacity-50"
      >
        {pending ? '送信中…' : 'はい、通知する'}
      </button>
      <button onClick={() => setArmed(false)} className="w-full rounded-xl bg-white py-2 text-sm font-bold text-neutral-600 ring-1 ring-neutral-300">
        やめる
      </button>
    </div>
  );
}

export function ExpireButton() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <button
        disabled={pending}
        onClick={() => start(async () => setMsg(`${await staffExpireStaleOffers()}件を失効させました`))}
        className="text-xs font-bold text-neutral-500 underline"
      >
        期限切れの案内を失効させる
      </button>
      {msg && <span className="ml-2 text-xs font-bold text-brand-700">{msg}</span>}
    </div>
  );
}
