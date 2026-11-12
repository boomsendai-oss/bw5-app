'use client';

// BW6 発表会のスタッフの最初の画面の「見てほしいこと」。0件なら見出しごと何も出さない。
// 番号ごとにまとめ、4番（入金）は件数の1行だけ。1番・3番には「問題なし」（2段階＋名前を選ぶ）。
import { useState, useTransition } from 'react';
import Link from 'next/link';
import type { AttentionItem } from '@/lib/recitalDb';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { dismissAttentionAction } from './actions';

const GROUPS: { no: AttentionItem['no']; title: string }[] = [
  { no: 1, title: '同じ申込かもしれない' },
  { no: 2, title: '会員との照合' },
  { no: 3, title: '特別な料金' },
  { no: 4, title: '入金' },
  { no: 5, title: '返金' },
  { no: 8, title: 'メール' },
];

function withEv(href: string, ev: string): string {
  return `${href}${href.includes('?') ? '&' : '?'}ev=${encodeURIComponent(ev)}`;
}

export default function AttentionList({ items, ev }: { items: AttentionItem[]; ev: string }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4">
      <h2 className="text-lg font-bold text-navy-700">見てほしいこと {items.length}件</h2>
      <div className="mt-3 space-y-4">
        {GROUPS.map((g) => {
          const xs = items.filter((i) => i.no === g.no);
          if (xs.length === 0) return null;
          return (
            <div key={g.no}>
              <h3 className="text-sm font-bold text-sand-700">{g.title}</h3>
              <ul className="mt-1 divide-y divide-sand-100">
                {g.no === 4 ? (
                  <li className="py-2">
                    <Link href={withEv('/staff/bw6/bank', ev)} className="text-brand-700 underline">
                      見てほしい入金 {xs.length}件
                    </Link>
                  </li>
                ) : (
                  xs.map((it, k) => <AttentionRow key={`${it.no}-${it.householdId ?? ''}-${it.personId ?? ''}-${k}`} item={it} ev={ev} />)
                )}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function AttentionRow({ item, ev }: { item: AttentionItem; ev: string }) {
  const canDismiss = item.no === 1 || item.no === 3;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const confirm = () => {
    if (item.no !== 1 && item.no !== 3) return;
    if (!name) { setError('名前を選んでください'); return; }
    const payload = { no: item.no, householdId: item.householdId, personId: item.personId };
    startTransition(async () => {
      const r = await dismissAttentionAction(ev, payload, name);
      if (!r.ok) setError(r.error);
      else { setError(''); setOpen(false); }
    });
  };

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <Link href={withEv(item.href, ev)} className="min-w-0 break-words text-brand-700 underline">
        {item.label}
      </Link>
      {canDismiss && !open && (
        <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-navy-700">
          問題なし
        </button>
      )}
      {canDismiss && open && (
        <div className="flex flex-wrap items-center gap-2">
          <StaffNamePicker value={name} onChange={setName} />
          <button
            type="button"
            onClick={confirm}
            disabled={pending}
            className="rounded-md bg-brand-600 px-3 py-1 text-sm font-bold text-white disabled:opacity-50"
          >
            問題なしにする
          </button>
          <button type="button" onClick={() => { setOpen(false); setError(''); }} className="px-2 py-1 text-sm text-sand-700">
            やめる
          </button>
          {error && <span className="w-full text-sm text-red-700">{error}</span>}
        </div>
      )}
    </li>
  );
}
