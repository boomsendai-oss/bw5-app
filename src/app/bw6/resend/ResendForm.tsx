'use client';

// BW6 発表会の「マイページのURLを送ります」の欄とボタン（04 4-2「URLをなくしたとき」）。
// 押したら答えの文を出し、ボタンは押せなくする。答えはいつも同じ文（申込があるかは出さない。resendUrlAction）。
import { useState, useTransition } from 'react';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { RECITAL_MSG } from '@/lib/recitalPublic';
import { resendUrlAction } from './actions';

const btnCls = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center text-base font-bold text-white disabled:opacity-40';

export function ResendForm({ eventKey, pv }: { eventKey: string; pv: string | null }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = () => {
    startTransition(async () => {
      try {
        setMessage((await resendUrlAction(eventKey, pv, email)).message);
      } catch {
        setMessage(RECITAL_MSG.rate);
      }
    });
  };

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-sm font-bold">メールアドレス</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          className={RECITAL_INPUT_CLS}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={message !== null}
        />
      </label>
      <button type="button" className={btnCls} onClick={send} disabled={pending || message !== null || email.trim() === ''}>
        送る
      </button>
      {message && <p className="rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-center text-base font-bold">{message}</p>}
    </div>
  );
}
