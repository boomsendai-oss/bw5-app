'use client';

// エントリーリストの部門タブ切り替え(TARO 2026-08-05: 縦積みだと埋まってきた時に見づらい)。
import { useState } from 'react';
import { BF6_DIVISIONS, type Bf6Division } from '@/lib/bf6';
import type { PublicBf6Entry } from '@/lib/bf6Db';

export default function EntryListTabs({
  lists,
  capacity,
}: {
  lists: Record<Bf6Division, PublicBf6Entry[]>;
  capacity: Record<Bf6Division, number>;
}) {
  const [active, setActive] = useState<Bf6Division>('beginner');
  const activeDef = BF6_DIVISIONS.find((d) => d.key === active)!;
  const list = lists[active] ?? [];

  return (
    <div>
      <div className="grid grid-cols-3 gap-1.5">
        {BF6_DIVISIONS.map((d) => {
          const isActive = d.key === active;
          return (
            <button
              key={d.key}
              onClick={() => setActive(d.key)}
              className={`rounded-xl px-2 py-3 text-center transition ${
                isActive ? `${d.accentBg} text-white ring-1 ring-black/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_4px_12px_rgba(0,0,0,0.4)]` : 'bg-neutral-900 text-neutral-400 border border-neutral-800'
              }`}
            >
              <span className="block text-xs font-black sm:text-sm">{d.key === 'beginner' && '🔰 '}{d.label}</span>
              <span className={`block text-lg font-black ${isActive ? 'text-white' : 'text-neutral-200'}`}>
                {(lists[d.key] ?? []).length}
                <span className={`text-xs font-bold ${isActive ? 'text-white/70' : 'text-neutral-400'}`}>
                  /{capacity[d.key]}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 shadow-sm">
        <div className={`px-4 py-2.5 ${activeDef.accentBg}`}>
          <p className="text-sm font-black text-white">
            {activeDef.label}
            <span className="ml-2 text-xs font-bold text-white/80">{activeDef.note}</span>
          </p>
        </div>
        {list.length === 0 ? (
          <p className="px-4 py-6 text-sm font-bold text-neutral-400">エントリー受付中!</p>
        ) : (
          <ol className="divide-y divide-neutral-800">
            {list.map((e, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="w-7 shrink-0 text-right text-sm font-black italic text-neutral-300">{i + 1}</span>
                <span className="flex-1">
                  <span className="text-base font-black text-white">{e.dancerName}</span>
                  <span className="block text-xs text-neutral-400">
                    {[e.genre, e.rep && `REP: ${e.rep}`].filter(Boolean).join(' / ')}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
