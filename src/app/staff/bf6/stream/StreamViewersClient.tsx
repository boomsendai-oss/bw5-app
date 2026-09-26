'use client';

// 視聴状況の一覧。5秒ごとに取り直す(当日、手元のスマホで見る前提)。
import { useEffect, useState } from 'react';
import type { StreamViewer } from '@/lib/bf6StreamDb';

const REFRESH_MS = 5000;

function hhmm(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  });
}

export function StreamViewersClient({ initial }: { initial: StreamViewer[] }) {
  const [rows, setRows] = useState(initial);
  const [updatedAt, setUpdatedAt] = useState<string>('');

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const r = await fetch('/api/staff/bf6/stream-viewers', { cache: 'no-store' });
        if (!r.ok || !alive) return;
        const j = (await r.json()) as { viewers?: StreamViewer[] };
        if (!alive || !Array.isArray(j.viewers)) return;
        setRows(j.viewers);
        setUpdatedAt(new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      } catch {
        /* 会場の回線が一瞬切れても画面を壊さない */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), REFRESH_MS);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const watching = rows.filter((v) => v.watching);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sand-200 bg-white p-5 text-center">
        <p className="text-xs font-bold text-neutral-500">いま接続中</p>
        <p className="mt-1 text-5xl font-black tabular-nums text-brand-700">
          {watching.length}
          <span className="ml-2 text-lg font-bold text-neutral-400">/ {rows.length} 件</span>
        </p>
        <p className="mt-2 text-xs leading-relaxed text-neutral-500">
          数えているのは端末の数です。1つのキーで同時に1台までなので、
          ご家族が同じ画面を4人で見ていても「1」と数えます。
        </p>
        {updatedAt && <p className="mt-1 text-[11px] text-neutral-400">最終更新 {updatedAt}</p>}
      </div>

      <ul className="divide-y divide-sand-200 overflow-hidden rounded-2xl border border-sand-200 bg-white">
        {rows.map((v) => (
          <li key={v.keyId} className="flex items-center gap-3 p-4">
            <span
              className={`h-3 w-3 shrink-0 rounded-full ${v.watching ? 'bg-brand-500' : 'bg-neutral-300'}`}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-navy-900">
                {v.buyerName || '(テストキー)'}
              </span>
              <span className="block truncate text-xs text-neutral-500">{v.email}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className={`block text-xs font-black ${v.watching ? 'text-brand-700' : 'text-neutral-400'}`}>
                {v.watching ? '視聴中' : '未視聴'}
              </span>
              <span className="block text-[11px] text-neutral-500">
                {v.device} ／ {hhmm(v.lastSeenAt)}
              </span>
            </span>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="p-6 text-center text-sm text-neutral-500">配信チケットの購入がまだありません</li>
        )}
      </ul>
    </div>
  );
}
