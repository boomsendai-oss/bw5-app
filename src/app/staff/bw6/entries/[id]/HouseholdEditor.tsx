'use client';

// BW6 発表会のスタッフの「代わりに直す」（05 5-5）。人ごとの欄・出演・連絡する人の欄を直し、変わった欄だけを HouseholdEdit[] にして送る。
// 「確かめる」で dryRun（書かない）を通して合計と残りの前→あとを見せ（K227）、「この内容で直す」で書く（2段階。confirm() は使わない）。
// 理由は必須・家庭から聞いた日時は任意（datetime-local）・押す人の名前。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
// 鍵（edit_token）とメールアドレスは受け取らない。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { HouseholdEdit } from '@/lib/recitalEntryDb';
import { editHouseholdAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

export type EditorPerson = {
  id: number; last_name: string; first_name: string; last_kana: string; first_kana: string; birthday: string; display_name: string;
  tshirt_size: string; insta_handle: string; name_ok: number; photo_ok: number; sns_ok: number; staff_note: string;
};
export type EditorContact = {
  contact_last_name: string; contact_first_name: string; contact_last_kana: string; contact_first_kana: string; phone: string; staff_note: string;
};
/** 出演の今の状態（'' は出演の行なし。'' と passed〔見送り〕は今の値を出すだけで、送るのは出る／迷っている／やめた） */
export type CastValue = '' | 'in' | 'maybe' | 'out' | 'passed';

const PERSON_TEXT: { key: keyof EditorPerson; label: string; type?: string }[] = [
  { key: 'last_name', label: '姓' },
  { key: 'first_name', label: '名' },
  { key: 'last_kana', label: 'セイ' },
  { key: 'first_kana', label: 'メイ' },
  { key: 'birthday', label: '生年月日', type: 'date' },
  { key: 'display_name', label: '載せる名前' },
  { key: 'insta_handle', label: 'インスタ' },
];
const PERSON_FLAGS: { key: 'name_ok' | 'photo_ok' | 'sns_ok'; label: string }[] = [
  { key: 'name_ok', label: '名前を載せてよい' },
  { key: 'photo_ok', label: '写真に写ってよい' },
  { key: 'sns_ok', label: 'SNS に載せてよい' },
];
const CONTACT_TEXT: { key: keyof EditorContact; label: string; type?: string }[] = [
  { key: 'contact_last_name', label: '姓' },
  { key: 'contact_first_name', label: '名' },
  { key: 'contact_last_kana', label: 'セイ' },
  { key: 'contact_first_kana', label: 'メイ' },
  { key: 'phone', label: '電話', type: 'tel' },
];
const CAST_OPTIONS: { v: CastValue; label: string }[] = [
  { v: '', label: '（なし）' },
  { v: 'in', label: '出る' },
  { v: 'maybe', label: '迷っている' },
  { v: 'out', label: 'やめた' },
  { v: 'passed', label: '見送り' },
];

const castKey = (personId: number, workId: number) => `${personId}:${workId}`;

/** 変わった欄だけを HouseholdEdit[] にする（空の Tシャツ・インスタは null） */
function buildEdits(
  people0: EditorPerson[], people: EditorPerson[], casts0: Record<string, CastValue>, casts: Record<string, CastValue>,
  contact0: EditorContact, contact: EditorContact,
): HouseholdEdit[] {
  const edits: HouseholdEdit[] = [];
  for (const p of people) {
    const p0 = people0.find((x) => x.id === p.id);
    if (!p0) continue;
    const fields: Record<string, string | number | null> = {};
    for (const k of Object.keys(p) as (keyof EditorPerson)[]) {
      if (k === 'id' || p[k] === p0[k]) continue;
      const v = p[k];
      fields[k] = (k === 'tshirt_size' || k === 'insta_handle') && v === '' ? null : v;
    }
    if (Object.keys(fields).length > 0) edits.push({ type: 'person', personId: p.id, fields } as HouseholdEdit);
  }
  for (const [k, v] of Object.entries(casts)) {
    if (v === casts0[k] || v === '' || v === 'passed') continue;
    const [personId, workId] = k.split(':').map(Number);
    edits.push({ type: 'cast_set', personId, workId, status: v });
  }
  const cf: Record<string, string> = {};
  for (const k of Object.keys(contact) as (keyof EditorContact)[]) if (contact[k] !== contact0[k]) cf[k] = contact[k];
  if (Object.keys(cf).length > 0) edits.push({ type: 'contact', fields: cf } as HouseholdEdit);
  return edits;
}

type Preview = { totalBefore: number; totalAfter: number; remainingBefore: number | null; remainingAfter: number | null };

export default function HouseholdEditor(props: {
  householdId: number; people: EditorPerson[]; contact: EditorContact; works: { id: number; work_code: string; title: string }[];
  casts: Record<string, CastValue>; tshirtSizes: string[];
}) {
  const { householdId, works, tshirtSizes } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState(props.people);
  const [casts, setCasts] = useState(props.casts);
  const [contact, setContact] = useState(props.contact);
  const [reason, setReason] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  // 欄を1つでも変えたら、確かめ直す
  const touch = () => { setPreview(null); setError(''); };
  const setPerson = (id: number, k: keyof EditorPerson, v: string | number) => {
    touch();
    setPeople((xs) => xs.map((p) => (p.id === id ? { ...p, [k]: v } : p)));
  };
  const reset = () => {
    setOpen(false); setPeople(props.people); setCasts(props.casts); setContact(props.contact);
    setReason(''); setReceivedAt(''); setPreview(null); setError('');
  };

  const edits = buildEdits(props.people, people, props.casts, casts, props.contact, contact);
  const x = { reason, receivedAtJst: receivedAt === '' ? null : receivedAt, staffName: name };

  const check = () => {
    if (edits.length === 0) { setError('変えた欄がありません'); return; }
    if (reason.trim() === '') { setError('理由を入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await editHouseholdAction(householdId, edits, { ...x, dryRun: true });
      if (!r.ok) { setError(r.error); return; }
      setError('');
      setPreview(r);
    });
  };
  const save = () => {
    startTransition(async () => {
      const r = await editHouseholdAction(householdId, edits, x);
      if (!r.ok) { setError(r.error); setPreview(null); return; }
      reset();
      setMsg(r.totalAfter !== r.totalBefore ? `直しました（合計 ${yen(r.totalBefore)} → ${yen(r.totalAfter)}）` : '直しました');
      router.refresh();
    });
  };

  if (!open) {
    return (
      <div className="rounded-lg border border-sand-200 bg-white p-3">
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className={BTN_MAIN}>代わりに直す</button>
        {msg && <p className="mt-2 text-sm font-bold text-navy-700">{msg}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border border-brand-200 bg-white p-3 text-navy-700">
      <h3 className="font-bold">代わりに直す</h3>
      {people.map((p) => (
        <fieldset key={p.id} className="space-y-3 rounded-lg border border-sand-200 p-3">
          <legend className="px-1 text-sm font-bold">{props.people.find((x) => x.id === p.id)?.last_name} {props.people.find((x) => x.id === p.id)?.first_name}</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {PERSON_TEXT.map((f) => (
              <label key={f.key} className="block text-sm">
                {f.label}
                <input
                  type={f.type ?? 'text'}
                  value={String(p[f.key])}
                  onChange={(e) => setPerson(p.id, f.key, e.target.value)}
                  className={`${RECITAL_INPUT_CLS} mt-1`}
                />
              </label>
            ))}
            <label className="block text-sm">
              Tシャツ
              <select value={p.tshirt_size} onChange={(e) => setPerson(p.id, 'tshirt_size', e.target.value)} className={`${RECITAL_INPUT_CLS} mt-1`}>
                <option value="">（なし）</option>
                {tshirtSizes.map((s) => <option key={s} value={s}>{s}</option>)}
                {p.tshirt_size !== '' && !tshirtSizes.includes(p.tshirt_size) && <option value={p.tshirt_size}>{p.tshirt_size}</option>}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            {PERSON_FLAGS.map((f) => (
              <label key={f.key} className="flex items-center gap-2">
                <input type="checkbox" checked={p[f.key] === 1} onChange={(e) => setPerson(p.id, f.key, e.target.checked ? 1 : 0)} className="h-4 w-4 accent-brand-600" />
                {f.label}
              </label>
            ))}
          </div>
          <label className="block text-sm">
            メモ
            <textarea value={p.staff_note} onChange={(e) => setPerson(p.id, 'staff_note', e.target.value)} rows={2} className={`${RECITAL_INPUT_CLS} mt-1`} />
          </label>
          <div>
            <p className="text-sm font-bold">出演</p>
            <ul className="mt-1 divide-y divide-sand-100">
              {works.map((w) => {
                const k = castKey(p.id, w.id);
                return (
                  <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="min-w-0 break-words text-sm"><span className="font-mono">{w.work_code}</span> {w.title}</span>
                    <select
                      value={casts[k] ?? ''}
                      onChange={(e) => { touch(); setCasts((c) => ({ ...c, [k]: e.target.value as CastValue })); }}
                      className="rounded-md border border-sand-300 bg-white px-2 py-1 text-base text-navy-900"
                      aria-label={`${w.work_code} の出演`}
                    >
                      {CAST_OPTIONS.filter((o) => (o.v !== '' && o.v !== 'passed') || o.v === (props.casts[k] ?? '')).map((o) => (
                        <option key={o.v} value={o.v}>{o.label}</option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
        </fieldset>
      ))}

      <fieldset className="space-y-3 rounded-lg border border-sand-200 p-3">
        <legend className="px-1 text-sm font-bold">連絡する人</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTACT_TEXT.map((f) => (
            <label key={f.key} className="block text-sm">
              {f.label}
              <input
                type={f.type ?? 'text'}
                value={contact[f.key]}
                onChange={(e) => { touch(); setContact((c) => ({ ...c, [f.key]: e.target.value })); }}
                className={`${RECITAL_INPUT_CLS} mt-1`}
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          メモ
          <textarea value={contact.staff_note} onChange={(e) => { touch(); setContact((c) => ({ ...c, staff_note: e.target.value })); }} rows={2} className={`${RECITAL_INPUT_CLS} mt-1`} />
        </label>
      </fieldset>

      <div className="space-y-3 rounded-lg bg-sand-50 p-3">
        <label className="block text-sm">
          理由（必須）
          <input type="text" value={reason} onChange={(e) => { touch(); setReason(e.target.value); }} className={`${RECITAL_INPUT_CLS} mt-1`} />
        </label>
        <label className="block text-sm">
          家庭から聞いた日時（任意）
          <input type="datetime-local" value={receivedAt} onChange={(e) => { touch(); setReceivedAt(e.target.value); }} className={`${RECITAL_INPUT_CLS} mt-1`} />
        </label>
        {preview && (
          <p className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-navy-800">
            合計 {yen(preview.totalBefore)} → {yen(preview.totalAfter)}
            {preview.remainingBefore != null && preview.remainingAfter != null && (
              <>　／　残り {yen(preview.remainingBefore)} → {yen(preview.remainingAfter)}</>
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <StaffNamePicker value={name} onChange={(v) => { touch(); setName(v); }} />
          {!preview ? (
            <button type="button" onClick={check} disabled={pending} className={BTN_MAIN}>確かめる</button>
          ) : (
            <button type="button" onClick={save} disabled={pending} className={BTN_MAIN}>この内容で直す</button>
          )}
          <button type="button" onClick={reset} disabled={pending} className={BTN_SUB}>やめる</button>
        </div>
        {error && <p className="text-sm font-bold text-red-700">{error}</p>}
      </div>
    </div>
  );
}
