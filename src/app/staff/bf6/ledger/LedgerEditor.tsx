'use client';

// 台帳の追加・削除・回収/支払いの切り替え。削除は2段階(誤操作で金額が消えないように)。
import { useState, useTransition } from 'react';
import type { LedgerEntry } from '@/lib/eventLedgerDb';
import { staffAddLedger, staffToggleLedgerCollected, staffDeleteLedger } from './actions';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default function LedgerEditor({ entries }: { entries: LedgerEntry[] }) {
  const incomes = entries.filter((e) => e.kind === 'income');
  const costs = entries.filter((e) => e.kind === 'cost');
  return (
    <div className="space-y-4">
      <Section title="アプリ外の入金" kind="income" rows={incomes} emptyHint="現金で集めた出演費・協賛金など" />
      <Section title="支出" kind="cost" rows={costs} emptyHint="ギャラ・賞金・備品など" />
    </div>
  );
}

function Section({
  title, kind, rows, emptyHint,
}: { title: string; kind: 'income' | 'cost'; rows: LedgerEntry[]; emptyHint: string }) {
  const [open, setOpen] = useState(false);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-navy-800">
          {title}
          <span className="ml-2 font-normal text-neutral-500">{rows.length}件</span>
        </h2>
        <span className="text-sm font-bold tabular-nums text-navy-800">{yen(total)}</span>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-neutral-500">まだありません({emptyHint})</p>
      ) : (
        <ul className="mt-3 divide-y divide-sand-100">
          {rows.map((r) => <RowItem key={r.id} row={r} />)}
        </ul>
      )}

      {open ? (
        <AddForm kind={kind} onDone={() => setOpen(false)} />
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="mt-3 rounded border border-brand-300 px-3 py-1.5 text-xs font-bold text-brand-700 hover:bg-brand-50"
        >
          + {title}を追加
        </button>
      )}
    </section>
  );
}

function RowItem({ row }: { row: LedgerEntry }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const doneLabel = row.kind === 'income' ? '受取済み' : '支払済み';

  return (
    <li className="flex flex-wrap items-center gap-2 py-2.5">
      <span className="flex-1 min-w-[180px]">
        <span className="text-sm font-bold text-navy-800">{row.label}</span>
        {row.qty > 1 && (
          <span className="ml-2 text-xs text-neutral-500">{row.qty}×{yen(row.unitAmount)}</span>
        )}
        {row.note && <span className="block text-xs text-neutral-400">{row.note}</span>}
      </span>
      <span className="text-sm font-bold tabular-nums text-navy-800">{yen(row.amount)}</span>
      <button
        disabled={pending}
        onClick={() => startTransition(() => staffToggleLedgerCollected(row.id, !row.collected))}
        className={`rounded px-2 py-1 text-xs font-bold disabled:opacity-50 ${
          row.collected ? 'bg-emerald-100 text-emerald-700' : 'border border-sand-300 text-neutral-500'
        }`}
      >
        {row.collected ? `✓ ${doneLabel}` : `${doneLabel}にする`}
      </button>
      {confirming ? (
        <span className="flex items-center gap-1">
          <button
            disabled={pending}
            onClick={() => startTransition(() => staffDeleteLedger(row.id))}
            className="rounded bg-red-600 px-2 py-1 text-xs font-bold text-white disabled:opacity-50"
          >
            削除する
          </button>
          <button onClick={() => setConfirming(false)} className="text-xs text-neutral-500">やめる</button>
        </span>
      ) : (
        <button onClick={() => setConfirming(true)} className="text-xs text-neutral-400 hover:text-red-600">削除</button>
      )}
    </li>
  );
}

function AddForm({ kind, onDone }: { kind: 'income' | 'cost'; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [f, setF] = useState({ label: '', category: '', qty: '1', unitAmount: '', collected: false, note: '' });

  const set = (k: string, v: string | boolean) => setF((p) => ({ ...p, [k]: v }));

  return (
    <div className="mt-3 rounded-lg border border-sand-200 bg-sand-50 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-bold text-neutral-600">
          項目名
          <input
            value={f.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder={kind === 'income' ? '例: ショーケース出演費' : '例: ジャッジ'}
            className="mt-1 w-full rounded border border-sand-300 px-2 py-1.5 text-sm font-normal"
          />
        </label>
        <label className="text-xs font-bold text-neutral-600">
          分類(任意)
          <input
            value={f.category}
            onChange={(e) => set('category', e.target.value)}
            placeholder="例: ギャラ / 賞金 / 備品"
            className="mt-1 w-full rounded border border-sand-300 px-2 py-1.5 text-sm font-normal"
          />
        </label>
        <label className="text-xs font-bold text-neutral-600">
          人数・個数
          <input
            type="number" min={1} value={f.qty}
            onChange={(e) => set('qty', e.target.value)}
            className="mt-1 w-full rounded border border-sand-300 px-2 py-1.5 text-sm font-normal tabular-nums"
          />
        </label>
        <label className="text-xs font-bold text-neutral-600">
          単価(円)
          <input
            type="number" min={0} value={f.unitAmount}
            onChange={(e) => set('unitAmount', e.target.value)}
            placeholder="2500"
            className="mt-1 w-full rounded border border-sand-300 px-2 py-1.5 text-sm font-normal tabular-nums"
          />
        </label>
        <label className="text-xs font-bold text-neutral-600 sm:col-span-2">
          メモ(任意)
          <input
            value={f.note}
            onChange={(e) => set('note', e.target.value)}
            className="mt-1 w-full rounded border border-sand-300 px-2 py-1.5 text-sm font-normal"
          />
        </label>
      </div>

      <label className="mt-2 flex items-center gap-2 text-xs font-bold text-neutral-600">
        <input type="checkbox" checked={f.collected} onChange={(e) => set('collected', e.target.checked)} />
        {kind === 'income' ? 'もう受け取っている' : 'もう支払っている'}
      </label>

      <p className="mt-2 text-xs text-neutral-500">
        合計 <span className="font-bold text-navy-800">
          ¥{((Number(f.qty) || 0) * (Number(f.unitAmount) || 0)).toLocaleString()}
        </span>
      </p>

      {error && <p className="mt-2 text-xs font-bold text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const r = await staffAddLedger({
                kind,
                category: f.category,
                label: f.label,
                qty: Number(f.qty) || 1,
                unitAmount: Number(f.unitAmount) || 0,
                collected: f.collected,
                note: f.note,
              });
              if (r.ok) onDone();
              else setError(r.error);
            })
          }
          className="rounded bg-brand-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {pending ? '追加中…' : '追加する'}
        </button>
        <button onClick={onDone} className="rounded border border-sand-300 px-3 py-1.5 text-xs text-neutral-500">
          やめる
        </button>
      </div>
    </div>
  );
}
