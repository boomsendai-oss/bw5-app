'use client';

// 受付開始・締切までのカウントダウン(1秒ごとに更新)。時刻はサーバから渡すepochミリ秒。
import { useEffect, useState } from 'react';

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), sec: s % 60 };
}

export default function Countdown({ label, targetMs, tone = 'red' }: { label: string; targetMs: number; tone?: 'red' | 'green' }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  // サーバ描画とずれないよう、マウントまでは数字を出さない
  const p = now == null ? null : parts(targetMs - now);
  if (p && targetMs - (now ?? 0) <= 0) return null;
  const bg = tone === 'red' ? 'bg-[#d4302a]' : 'bg-[#2f8a3e]';
  return (
    <div className="text-center">
      <p className="text-xs font-black">{label}</p>
      <p className="mt-1 flex items-end justify-center gap-1 font-black">
        <span className="text-sm">あと</span>
        {[
          [p?.d, '日'],
          [p?.h, '時間'],
          [p?.m, '分'],
          [p?.sec, '秒'],
        ].map(([v, u]) => (
          <span key={u as string} className="flex items-end gap-0.5">
            <span className={`inline-block min-w-[2.2rem] rounded border-[3px] border-[#1a1410] ${bg} px-1 text-2xl leading-tight text-white tabular-nums`}>
              {v == null ? '--' : String(v).padStart(2, '0')}
            </span>
            <span className="text-xs">{u as string}</span>
          </span>
        ))}
      </p>
    </div>
  );
}
