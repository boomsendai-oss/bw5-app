'use client';

// 控えページのURLの再送。登録の有無は画面に出さない(誰のアドレスでも同じ表示)。
import { useState } from 'react';
import { requestXmasLinkResend } from './actions';
import { Notice, inputCls } from './ui';

export default function ResendForm() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const r = await requestXmasLinkResend(email);
    setBusy(false);
    setMsg(
      r.ok
        ? { tone: 'info', text: 'お申し込みが確認できたアドレスには、控えのURLを送りました。届かない場合は公式LINEへご連絡ください。' }
        : { tone: 'error', text: r.error ?? '送れませんでした' }
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2">
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="申込時のメールアドレス"
        autoComplete="email"
        className={`${inputCls} min-w-0 flex-1 py-2 text-sm`}
      />
      <button
        type="submit"
        disabled={busy}
        className="shrink-0 rounded-lg border-[3px] border-[#1a1410] bg-[#1a1410] px-3 text-sm font-black text-white disabled:opacity-50"
      >
        {busy ? '送信中' : '送る'}
      </button>
      {msg && (
        <div className="basis-full">
          <Notice tone={msg.tone}>{msg.text}</Notice>
        </div>
      )}
    </form>
  );
}
