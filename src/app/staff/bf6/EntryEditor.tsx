'use client';

// スタッフ: 出場者情報の修正フォーム。部門・学年・金額はここでは変えない(誤操作防止)。
import { useState, useTransition } from 'react';
import { staffUpdateEntryItem } from './actions';

const inputCls =
  'w-full rounded-lg border border-sand-300 bg-white px-2.5 py-1.5 text-sm text-navy-800 focus:border-brand-500 focus:outline-none';

export interface EntryEditorProps {
  itemId: number;
  dancerName: string;
  dancerKana: string;
  performerName: string;
  genre: string;
  rep: string;
  instagram: string;
}

export default function EntryEditor(props: EntryEditorProps) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    dancerName: props.dancerName,
    dancerKana: props.dancerKana,
    performerName: props.performerName,
    genre: props.genre,
    rep: props.rep,
    instagram: props.instagram,
  });
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    setError('');
    startTransition(async () => {
      const res = await staffUpdateEntryItem(props.itemId, form);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setSaved(true);
      setOpen(false);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  if (!open) {
    return (
      <span className="ml-2 inline-flex items-center gap-2">
        <button
          onClick={() => setOpen(true)}
          className="rounded-lg border border-sand-300 px-2 py-0.5 text-xs font-bold text-neutral-500 hover:border-brand-500 hover:text-brand-700"
        >
          修正
        </button>
        {saved && <span className="text-xs font-bold text-brand-600">✓ 保存しました</span>}
      </span>
    );
  }

  const fields: { key: keyof typeof form; label: string; hint?: string }[] = [
    { key: 'dancerName', label: 'ダンサーネーム', hint: '公開リストに出ます' },
    { key: 'dancerKana', label: 'フリガナ', hint: 'カタカナ・MC読み上げ用' },
    { key: 'performerName', label: '本名(カナ)', hint: '非公開' },
    { key: 'genre', label: 'ジャンル', hint: '公開・DJの選曲に使用' },
    { key: 'rep', label: 'レペゼン', hint: '公開リストに出ます' },
    { key: 'instagram', label: 'Instagram', hint: '任意' },
  ];

  return (
    <div className="mt-2 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {fields.map((f) => (
          <label key={f.key} className="block text-xs text-neutral-500">
            {f.label}
            {f.hint && <span className="ml-1 text-[10px] text-neutral-400">({f.hint})</span>}
            <input
              value={form[f.key]}
              onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              className={inputCls}
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-neutral-500">
        ※ 部門・学年・金額はここでは変更できません(定員と料金に影響するため)。変更が必要な場合はご相談ください。
      </p>
      {error && <p className="mt-2 rounded-lg bg-red-50 p-2 text-xs font-bold text-red-600">{error}</p>}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存する'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError('');
            setForm({
              dancerName: props.dancerName,
              dancerKana: props.dancerKana,
              performerName: props.performerName,
              genre: props.genre,
              rep: props.rep,
              instagram: props.instagram,
            });
          }}
          disabled={pending}
          className="rounded-lg border border-sand-300 px-3 py-1.5 text-xs font-bold text-neutral-500"
        >
          やめる
        </button>
      </div>
    </div>
  );
}
