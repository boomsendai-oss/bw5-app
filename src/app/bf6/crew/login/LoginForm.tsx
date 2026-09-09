'use client';

import { useActionState } from 'react';
import { crewLogin } from './actions';

export default function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(crewLogin, null);

  return (
    <form action={action} className="mt-6 space-y-3">
      <input type="hidden" name="next" value={next} />
      <input
        name="pin"
        type="tel"
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="PIN"
        className="w-full rounded-xl border border-sand-300 bg-white px-4 py-4 text-center text-2xl font-black tracking-[0.4em] text-navy-900 outline-none focus:border-brand-500"
      />
      {state?.error && (
        <p className="rounded-lg bg-red-600 px-3 py-2 text-center text-sm font-bold text-white">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="w-full rounded-xl bg-brand-600 py-4 text-lg font-black text-white disabled:opacity-50"
      >
        {pending ? '確認中…' : '入る'}
      </button>
    </form>
  );
}
