'use client';

// 抽選の枠を用意する。エントリー締切(9/24)後に一度押せばよい。
// 再実行しても既存の枠は消えない(引き終わったあとに押しても安全)。
import { useState, useTransition } from 'react';
import { receptionSeedSlots } from './actions';
import type { Bf6DrawDivision, Bf6DrawPhase } from '@/lib/bf6Draw';

const DIVS: { key: Bf6DrawDivision; label: string }[] = [
  { key: 'beginner', label: 'ビギナー' },
  { key: 'kids', label: '小中学生' },
  { key: 'general', label: '一般' },
];

export function SlotSeeder({ phase }: { phase: Bf6DrawPhase }) {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const targets = phase === 'bracket' ? DIVS.filter((d) => d.key !== 'beginner') : DIVS;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-xs font-bold text-neutral-400 underline">
        抽選枠の準備(締切後に一度だけ)
      </button>
    );
  }

  return (
    <div className="rounded-2xl border border-sand-300 bg-sand-50 p-4">
      <p className="text-sm font-black text-navy-900">抽選枠の準備</p>
      <p className="mt-1 text-xs text-neutral-500">
        {phase === 'block'
          ? 'ビギナーは16枠(固定)。小中・一般は実エントリー数を入れてください。'
          : 'ベスト8なので各8枠が作られます。人数の入力は不要です。'}
      </p>
      <div className="mt-3 space-y-2">
        {targets.map((d) => (
          <div key={d.key} className="flex items-center gap-2">
            <span className="w-24 text-sm font-bold text-navy-900">{d.label}</span>
            {phase === 'block' && d.key !== 'beginner' ? (
              <input
                type="number"
                inputMode="numeric"
                value={counts[d.key] ?? ''}
                onChange={(e) => setCounts({ ...counts, [d.key]: e.target.value })}
                placeholder="人数"
                className="h-10 w-24 rounded-lg border border-sand-300 px-2"
              />
            ) : (
              <span className="text-xs text-neutral-500">{d.key === 'beginner' ? '16枠' : '8枠'}</span>
            )}
            <button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const n = Number(counts[d.key] ?? 0);
                  const r = await receptionSeedSlots(d.key, phase, n);
                  setMsg(`${d.label}: 全${r.total}枠(新規${r.created})`);
                })
              }
              className="rounded-lg bg-brand-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              作成
            </button>
          </div>
        ))}
      </div>
      {msg && <p className="mt-3 text-xs font-bold text-brand-700">{msg}</p>}
      <button onClick={() => setOpen(false)} className="mt-3 text-xs font-bold text-neutral-400 underline">
        閉じる
      </button>
    </div>
  );
}
