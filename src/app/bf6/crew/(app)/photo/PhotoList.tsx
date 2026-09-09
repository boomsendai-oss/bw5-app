'use client';

// 写真撮影だけに絞った一覧。受付とは別の人が別の端末で回せるようにするための画面。
// 「まだの人」を上に出して、撮り終わった人は下に落ちる。
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import PhotoCapture from '@/app/staff/bf6/reception/PhotoCapture';

const DIV_LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };

export type PhotoRow = {
  itemId: number;
  dancerName: string;
  divisions: string[];
  hasPhoto: boolean;
  /** その部門でくじを引いた番号(撮る順番の目安になる) */
  slots: { division: string; slotNo: number }[];
};

export default function PhotoList({ rows }: { rows: PhotoRow[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [onlyTodo, setOnlyTodo] = useState(true);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return rows
      .filter((r) => (onlyTodo ? !r.hasPhoto : true))
      .filter((r) => (k ? r.dancerName.toLowerCase().includes(k) : true));
  }, [rows, q, onlyTodo]);

  const done = rows.filter((r) => r.hasPhoto).length;

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-sand-200 bg-white p-3">
        <p className="text-sm font-bold text-navy-900">
          撮影済み {done} / {rows.length} 人
        </p>
        <p className="mt-1 text-xs leading-relaxed text-neutral-500">
          無地の壁の前で、頭の上と左右に少し余白をあけて撮ってください。背景はその場で自動で抜けます。
        </p>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ダンサーネームで検索"
        className="w-full rounded-xl border border-sand-300 bg-white px-4 py-3 text-base outline-none focus:border-brand-500"
      />

      <button
        onClick={() => setOnlyTodo((v) => !v)}
        className={`w-full rounded-xl py-2.5 text-sm font-black ${
          onlyTodo ? 'bg-brand-600 text-white' : 'bg-sand-100 text-neutral-600'
        }`}
      >
        {onlyTodo ? 'まだ撮っていない人だけ表示中' : '全員表示中'}
      </button>

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
                {r.slots.length > 0 &&
                  ' · ' + r.slots.map((s) => `${DIV_LABEL[s.division] ?? s.division}${s.slotNo}番`).join(' ')}
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
            該当する人がいません
          </li>
        )}
      </ul>
    </div>
  );
}
