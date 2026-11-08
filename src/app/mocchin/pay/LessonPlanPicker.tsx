'use client';

// レッスン代の払い方を選ぶ(締切後・参加費を払った人)。選んだら保存して、ページを読み直す。
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { chooseMocchinLessonPlan } from '../actions';
import { Notice, btnCls } from '../ui';

export type PlanOption = { key: string; label: string; lines: string[] };

export default function LessonPlanPicker({ token, options }: { token: string; options: PlanOption[] }) {
  const router = useRouter();
  const [plan, setPlan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    if (!plan) {
      setError('払い方を1つ選んでください');
      return;
    }
    setBusy(true);
    setError('');
    const r = await chooseMocchinLessonPlan(token, plan);
    if (r.ok) {
      router.refresh();
      return;
    }
    setBusy(false);
    setError(r.error);
  }

  return (
    <>
      <p className="text-sm font-black">下の3つから1つタップして選んでください</p>
      <div className="mt-2 space-y-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            aria-pressed={plan === o.key}
            onClick={() => (setPlan(o.key), setError(''))}
            className={`flex w-full items-start gap-3 rounded-lg border-2 p-3 text-left ${
              plan === o.key ? 'border-[#19F2D6] bg-[#19F2D6] text-black' : 'border-white/40 bg-black text-white'
            }`}
          >
            <span
              aria-hidden
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${plan === o.key ? 'border-black' : 'border-white/70'}`}
            >
              {plan === o.key && <span className="h-2.5 w-2.5 rounded-full bg-black" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">{o.label}</span>
              {o.lines.map((l) => (
                <span key={l} className="mt-0.5 block text-xs font-bold">
                  {l}
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <button type="button" className={`${btnCls} mt-4`} disabled={busy} onClick={save}>
        {busy ? '保存中…' : 'この払い方に決める'}
      </button>
    </>
  );
}
