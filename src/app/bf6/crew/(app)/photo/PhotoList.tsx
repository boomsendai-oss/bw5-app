'use client';

// 写真撮影だけに絞った一覧。受付とは別の人が別の端末で回せるようにするための画面。
// 「まだの人」を上に出して、撮り終わった人は下に落ちる。
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhotoCapture from '@/app/staff/bf6/reception/PhotoCapture';
import { doneTabCounts, filterDoneTab, matchesAny, type DoneTab } from '@/lib/bf6ListUi';

const DIV_LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };

export type PhotoRow = {
  itemId: number;
  dancerName: string;
  divisions: string[];
  hasPhoto: boolean;
  /** その部門でくじを引いた番号(撮る順番の目安になる) */
  slots: { division: string; slotNo: number }[];
};

export default function PhotoList({ rows, division }: { rows: PhotoRow[]; division: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<DoneTab>('todo');

  const hasPhoto = (r: PhotoRow) => r.hasPhoto;
  const counts = doneTabCounts(rows, hasPhoto);
  const list = useMemo(
    () => filterDoneTab(rows, hasPhoto, tab).filter((r) => matchesAny([r.dancerName], q)),
    [rows, q, tab]
  );
  const done = counts.done;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sand-200 bg-white p-3">
        <p className="text-sm font-bold text-navy-900">
          {DIV_LABEL[division] ?? division}: 撮影済み {done} / {rows.length} 人
        </p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          無地の壁の前で、頭の上と左右に少し余白をあけて撮ってください。背景はその場で自動で抜けます。
        </p>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="名前で探す"
        className="w-full rounded-xl border border-sand-300 bg-white px-4 py-3 text-base text-navy-900 outline-none placeholder:text-neutral-500 focus:border-brand-500"
      />

      {/* 入場受付と同じ形のタブ。画面ごとに表現が違うと現場で迷う(TARO 2026-09-11) */}
      <div className="grid grid-cols-3 gap-2">
        {([
          { key: 'todo' as DoneTab, label: '未撮影' },
          { key: 'done' as DoneTab, label: '撮影済み' },
          { key: 'all' as DoneTab, label: '全員' },
        ]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-xl py-3 text-sm font-black leading-tight tabular-nums transition active:scale-95 ${
              tab === t.key ? 'bg-navy-900 text-white' : 'bg-sand-100 text-navy-800'
            }`}
          >
            {t.label}
            <span className="block text-base">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <ul className="space-y-2">
        {list.map((r) => (
          <li
            key={r.itemId}
            className="flex items-center justify-between gap-3 rounded-xl border border-sand-200 bg-white p-3"
          >
            <div className="min-w-0">
              <p className="truncate text-base font-black text-navy-900">{r.dancerName}</p>
              <p className="mt-0.5 text-xs text-neutral-500">
                {r.divisions.map((d) => DIV_LABEL[d] ?? d).join(' / ')}
                {r.slots.some((s) => s.division === division) &&
                  ` · ${r.slots.find((s) => s.division === division)!.slotNo}番`}
              </p>
            </div>
            <PhotoCapture
              itemId={r.itemId}
              dancerName={r.dancerName}
              hasPhoto={r.hasPhoto}
              onDone={() => router.refresh()}
            />
          </li>
        ))}
        {list.length === 0 && (
          <li className="rounded-xl bg-sand-100 p-4 text-center text-sm font-bold text-neutral-500">
            {tab === 'todo' ? '全員ぶん撮り終わっています' : '該当する人がいません'}
          </li>
        )}
      </ul>
    </div>
  );
}
