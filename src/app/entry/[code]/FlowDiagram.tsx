'use client';

import type { PartDef } from '@/lib/eventSignup';

// 演目の流れ: 全員(冒頭) → パート別(交代) → 全員(締め)
export default function FlowDiagram({ parts }: { parts: PartDef[] }) {
  const box = 'rounded-xl px-3 py-2 text-center text-xs font-bold border';
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2">演目の流れ</div>
      <div className="flex flex-col gap-2">
        <div className={`${box} bg-amber-50 border-amber-200 text-amber-700`}>全員（冒頭 1分）</div>
        <div className="text-center text-slate-300 text-sm">▼</div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
          <div className="text-[10px] text-slate-400 text-center mb-1.5">パートごとに交代</div>
          <div className="grid grid-cols-1 gap-1.5">
            {parts.map((p) => (
              <div key={p.key} className={`${box} bg-teal-50 border-teal-200 text-teal-700`}>
                {p.label}
                {p.note ? <span className="block text-[9px] font-normal text-teal-500 mt-0.5">{p.note}</span> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="text-center text-slate-300 text-sm">▼</div>
        <div className={`${box} bg-amber-50 border-amber-200 text-amber-700`}>全員（締め 1分）</div>
      </div>
    </div>
  );
}
