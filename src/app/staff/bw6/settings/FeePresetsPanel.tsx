'use client';

// BW6 発表会の特別な料金の事前登録（一覧・会員を探して登録・消す）。1人の会員に1行（もう一度入れると種類とメモを直す）。
// 消すのは2段階＋名前。足しても消しても、もう申し込んだ人の印は変わらない（K226）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { FeePresetRow } from '@/lib/recitalDb';
import type { MemberLite } from '@/lib/recitalMatch';
import { deleteFeePresetAction, saveFeePresetAction, searchMembersAction } from './actions';

type PresetClass = FeePresetRow['feeClass'];

const CLASS_LABEL: Record<PresetClass, string> = {
  no_coop: '協力チケットなし',
  tshirt_only: 'Tシャツ代だけ',
  free: '参加費なし',
};

const BTN_MAIN = 'rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-navy-700 disabled:opacity-50';

function memberText(m: MemberLite | null, memberId: number): string {
  if (!m) return `会員 ${memberId}（見つかりません）`;
  return `${m.fullName ?? '（名前なし）'}${m.fullNameKana ? `（${m.fullNameKana}）` : ''}`;
}

export default function FeePresetsPanel({ ev, presets }: { ev: string; presets: FeePresetRow[] }) {
  const [name, setName] = useState('');
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">特別な料金の事前登録</h2>
      <p className="mt-1 text-sm">
        受付を開ける前に入れる。あとから足しても、もう申し込んだ人は変わらない（世帯の画面の『特別な料金』で直す）
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <span>入れる人・消す人：</span>
        <StaffNamePicker value={name} onChange={setName} />
      </div>

      {presets.length === 0 ? (
        <p className="mt-3 text-sm text-sand-800">登録は、まだありません。</p>
      ) : (
        <ul className="mt-3 divide-y divide-sand-100">
          {presets.map((p) => <PresetRow key={p.id} ev={ev} row={p} name={name} />)}
        </ul>
      )}

      <AddPreset ev={ev} name={name} />
    </section>
  );
}

function PresetRow({ ev, row, name }: { ev: string; row: FeePresetRow; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const del = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await deleteFeePresetAction(ev, row.id, name);
      if (!r.ok) { setError(r.error); return; }
      setError('');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <p className="break-words font-bold">{memberText(row.member, row.memberId)}</p>
          <p>
            <span className="rounded bg-sand-100 px-1">{CLASS_LABEL[row.feeClass] ?? row.feeClass}</span>
            {row.memo && <span className="ml-2 break-words">{row.memo}</span>}
          </p>
          <p className="text-xs text-sand-800">入れた人：{row.createdBy || '—'}</p>
        </div>
        {!open && (
          <button type="button" onClick={() => setOpen(true)} className={BTN_SUB}>消す</button>
        )}
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-sand-50 p-2 text-sm">
          <span className="font-bold">この登録を消しますか。</span>
          <button type="button" onClick={del} disabled={pending} className={BTN_MAIN}>はい、消す</button>
          <button type="button" onClick={() => { setOpen(false); setError(''); }} disabled={pending} className={BTN_SUB}>やめる</button>
        </div>
      )}
      {error && <p className="mt-1 text-sm font-bold text-red-700">{error}</p>}
    </li>
  );
}

function AddPreset({ ev, name }: { ev: string; name: string }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<MemberLite[] | null>(null);
  const [picked, setPicked] = useState<MemberLite | null>(null);
  const [feeClass, setFeeClass] = useState<PresetClass>('no_coop');
  const [memo, setMemo] = useState('');
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');
  const [pending, startTransition] = useTransition();

  const search = () => {
    setOkMsg('');
    startTransition(async () => {
      setHits(await searchMembersAction(q));
    });
  };

  const save = () => {
    if (!picked) { setError('会員を選んでください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await saveFeePresetAction(ev, { memberId: picked.id, feeClass, memo: memo.trim() === '' ? null : memo }, name);
      if (!r.ok) { setError(r.error); return; }
      setError('');
      setOkMsg(`${picked.fullName ?? '会員'} を登録しました。`);
      setPicked(null);
      setHits(null);
      setQ('');
      setMemo('');
      router.refresh();
    });
  };

  return (
    <div className="mt-4 rounded-lg border border-sand-200 p-3">
      <h3 className="font-bold">登録する</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
          placeholder="会員の名前かカナ"
          className={`min-w-0 flex-1 ${RECITAL_INPUT_CLS}`}
          aria-label="会員を探す"
        />
        <button type="button" onClick={search} disabled={pending || q.trim() === ''} className={BTN_MAIN}>探す</button>
      </div>
      {hits !== null && (
        hits.length === 0 ? (
          <p className="mt-2 text-sm text-sand-800">見つかりませんでした。</p>
        ) : (
          <ul className="mt-2 max-h-64 divide-y divide-sand-100 overflow-y-auto rounded-lg border border-sand-200">
            {hits.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => { setPicked(m); setError(''); }}
                  className={`block w-full px-3 py-2 text-left text-sm ${picked?.id === m.id ? 'bg-brand-50 font-bold text-brand-800' : 'bg-white text-navy-700'}`}
                >
                  {memberText(m, m.id)}
                  {m.birthday && <span className="ml-2 text-xs text-sand-800">{m.birthday}</span>}
                  {m.status && m.status !== 'active' && <span className="ml-2 text-xs text-red-700">{m.status === 'leave' ? '休会' : m.status === 'withdrew' ? '退会' : m.status}</span>}
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {picked && (
        <div className="mt-3 space-y-2">
          <p className="text-sm">選んだ会員：<span className="font-bold">{memberText(picked, picked.id)}</span></p>
          <label className="block text-sm">
            種類
            <select value={feeClass} onChange={(e) => setFeeClass(e.target.value as PresetClass)} className={`mt-1 ${RECITAL_INPUT_CLS}`}>
              {(Object.keys(CLASS_LABEL) as PresetClass[]).map((k) => <option key={k} value={k}>{CLASS_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="block text-sm">
            メモ（空でよい）
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={200} className={`mt-1 ${RECITAL_INPUT_CLS}`} />
          </label>
          <button type="button" onClick={save} disabled={pending} className={BTN_MAIN}>登録する</button>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
      {okMsg && <p className="mt-2 text-sm text-brand-800">{okMsg}</p>}
    </div>
  );
}
