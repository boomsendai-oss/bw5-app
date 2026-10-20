'use client';

// 確定済みの申込へ控えメールをまとめて送り直す(メール設定の不具合で届いていなかった分)。送る人の名前を入れてから押す(2段階で誤送信を防ぐ)。
import { useState, useTransition } from 'react';
import { resendXmasConfirmations } from './actions';

export default function ConfirmationResendButton({ missing }: { missing: number }) {
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState('');

  if (missing === 0) return <span className="text-xs text-neutral-500">送り直す控えメールはありません</span>;

  function run() {
    setMsg('');
    start(async () => {
      const r = await resendXmasConfirmations(name);
      setArmed(false);
      setMsg(r.ok ? `${r.sent}件に送りました${r.failed ? `(失敗${r.failed})` : ''}` : r.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="送る人の名前"
        className="w-28 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-slate-900 placeholder:text-slate-400"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => (armed ? run() : setArmed(true))}
        className={`rounded border px-2 py-1 font-semibold ${armed ? 'border-red-600 bg-red-600 text-white' : 'border-brand-600 bg-white text-brand-700'}`}
      >
        {pending ? '送信中…' : armed ? `もう一度押すと${missing}件に送信` : `控えメールを${missing}件送り直す`}
      </button>
      {msg && <span className="font-semibold text-navy-800">{msg}</span>}
    </div>
  );
}
