'use client';

// BW6 発表会のスタッフの世帯の画面の「世帯をまとめる」（Task 20・5-2・5-7）。
// 相手の世帯を整理番号か名前で探す → どちらに残すか（初めは先に申し込んだ方＝seq が小さい方を残す）→ 同じ人の組
// （カナと生年月日が同じ人の組を初めから並べる。残すのは、残す世帯の人）→ 理由 → たしかめる（dryRun）→ まとめる。
// 2段階＋名前を選ぶ（confirm() は使わない）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { HouseholdHit } from '@/lib/recitalDb';
import { householdPeopleAction, mergeAction, searchHouseholdsAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

export type MergePerson = { id: number; name: string; kana: string; birthday: string };
type Preview = { totalBefore: number; totalAfter: number; moved: number; refund: number };

const kanaKey = (s: string) => s.normalize('NFKC').replace(/[\s　・ー]/g, '');

/** from の人ごとに、into の同じ人（カナと生年月日が同じ）を初めの値にする。無ければ 0（別の人） */
function defaultPairs(fromPeople: MergePerson[], intoPeople: MergePerson[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of fromPeople) {
    const hit = p.birthday !== '' ? intoPeople.find((q) => q.birthday === p.birthday && kanaKey(q.kana) !== '' && kanaKey(q.kana) === kanaKey(p.kana)) : undefined;
    out[p.id] = hit?.id ?? 0;
  }
  return out;
}

export default function MergePanel(props: { householdId: number; eventKey: string; seq: number; refCode: string; people: MergePerson[] }) {
  const { householdId, eventKey, seq, refCode, people } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<HouseholdHit[] | null>(null);
  const [other, setOther] = useState<HouseholdHit | null>(null);
  const [otherPeople, setOtherPeople] = useState<MergePerson[]>([]);
  const [keepThis, setKeepThis] = useState(true);
  const [pairs, setPairs] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  const fromPeople = keepThis ? otherPeople : people;
  const intoPeople = keepThis ? people : otherPeople;
  const fromId = keepThis ? other?.id ?? 0 : householdId;
  const intoId = keepThis ? householdId : other?.id ?? 0;
  const thisLabel = `この世帯（${refCode}）`;
  const otherLabel = other ? `相手の世帯（${other.ref_code}）` : '';

  const reset = () => {
    setOpen(false); setQ(''); setHits(null); setOther(null); setOtherPeople([]); setPairs({}); setReason(''); setPreview(null); setError('');
  };
  const search = () => {
    setError('');
    startTransition(async () => {
      const r = await searchHouseholdsAction(eventKey, q);
      setHits(r.filter((h) => h.id !== householdId));
    });
  };
  const pick = (h: HouseholdHit) => {
    setError('');
    setPreview(null);
    startTransition(async () => {
      const ps = await householdPeopleAction(h.id);
      const keep = seq <= h.seq;
      setOther(h);
      setOtherPeople(ps);
      setKeepThis(keep);
      setPairs(defaultPairs(keep ? ps : people, keep ? people : ps));
    });
  };
  const flip = (v: boolean) => {
    setKeepThis(v);
    setPairs(defaultPairs(v ? otherPeople : people, v ? people : otherPeople));
    setPreview(null);
  };
  const samePeople = () => Object.entries(pairs).filter(([, keep]) => keep > 0).map(([drop, keep]) => ({ dropPersonId: Number(drop), keepPersonId: keep }));

  const check = () => {
    if (!other) { setError('相手の世帯を選んでください'); return; }
    if (other.status !== 'active') { setError('相手の世帯は、もうまとめてあります'); return; }
    if (reason.trim() === '') { setError('理由を入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    const sp = samePeople();
    if (new Set(sp.map((x) => x.keepPersonId)).size !== sp.length) { setError('残す人が重なっています。同じ人の組を確かめてください'); return; }
    setError('');
    startTransition(async () => {
      const r = await mergeAction(fromId, intoId, { reason, samePeople: sp }, name, true);
      if (!r.ok) { setError(r.error); return; }
      setPreview(r);
    });
  };
  const go = () => {
    startTransition(async () => {
      const r = await mergeAction(fromId, intoId, { reason, samePeople: samePeople() }, name, false);
      if (!r.ok) { setError(r.error); setPreview(null); return; }
      const into = keepThis ? null : other;
      reset();
      setMsg(`まとめました（合計 ${yen(r.totalAfter)}・返す分 ${yen(r.refund)}）。`);
      if (into) router.push(`/staff/bw6/entries/${into.id}`);
      else router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3 text-navy-700">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className={BTN_SUB}>世帯をまとめる</button>
      ) : (
        <div className="space-y-3">
          <h3 className="font-bold">世帯をまとめる</h3>
          <p className="text-xs text-sand-700">家庭に確かめてから押します。入金はまとめ先へ移し、多く払った分は「返す分」になります。整理番号は両方残ります。</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block min-w-0 flex-1 text-sm">
              相手の世帯（整理番号か名前）
              <input
                type="text"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(); } }}
                className={`${RECITAL_INPUT_CLS} mt-1`}
              />
            </label>
            <button type="button" onClick={search} disabled={pending || q.trim() === ''} className={BTN_SUB}>探す</button>
          </div>
          {hits && hits.length === 0 && <p className="text-sm text-sand-700">見つかりません</p>}
          {hits && hits.length > 0 && (
            <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    type="button"
                    onClick={() => pick(h)}
                    disabled={pending || h.status !== 'active'}
                    className={`flex w-full flex-wrap gap-x-3 px-3 py-2 text-left text-sm disabled:opacity-50 ${other?.id === h.id ? 'bg-brand-50 font-bold' : ''}`}
                  >
                    <span className="font-mono">{h.ref_code}</span>
                    <span className="min-w-0 break-words">{h.contact_name}</span>
                    {h.status !== 'active' && <span className="text-sand-700">（まとめた）</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {other && (
            <>
              <fieldset className="space-y-1 text-sm">
                <legend className="mb-1 font-bold">どちらに残すか</legend>
                <label className="flex items-center gap-2">
                  <input type="radio" name="merge-keep" checked={keepThis} onChange={() => flip(true)} className="h-4 w-4 accent-brand-600" />
                  {thisLabel}に残す
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="merge-keep" checked={!keepThis} onChange={() => flip(false)} className="h-4 w-4 accent-brand-600" />
                  {otherLabel}に残す
                </label>
                <p className="text-xs text-sand-700">初めは、先に申し込んだ方を残します。</p>
              </fieldset>

              <div className="space-y-2 text-sm">
                <p className="font-bold">移す人（{keepThis ? otherLabel : thisLabel}）</p>
                {fromPeople.length === 0 && <p className="text-sand-700">人がいません</p>}
                {fromPeople.map((p) => (
                  <label key={p.id} className="block">
                    <span className="break-words">{p.name}（{p.kana}・{p.birthday || '生年月日なし'}）</span>
                    <select
                      value={pairs[p.id] ?? 0}
                      onChange={(e) => { setPairs({ ...pairs, [p.id]: Number(e.target.value) }); setPreview(null); }}
                      className={`${RECITAL_INPUT_CLS} mt-1`}
                    >
                      <option value={0}>別の人（そのまま移す）</option>
                      {intoPeople.map((t) => (
                        <option key={t.id} value={t.id}>同じ人：{t.name}（{t.kana}・{t.birthday || '生年月日なし'}）を残す</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>

              <label className="block text-sm">
                理由（必須）
                <input type="text" value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="例：きょうだいが別々に申し込んだ" className={`${RECITAL_INPUT_CLS} mt-1`} />
              </label>
              {preview && (
                <div className="space-y-1 rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-navy-800">
                  <p className="font-bold">合計 {yen(preview.totalBefore)} → {yen(preview.totalAfter)}</p>
                  <p>移す入金 {yen(preview.moved)}</p>
                  <p>返す分 {yen(preview.refund)}</p>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <StaffNamePicker value={name} onChange={(v) => { setName(v); setPreview(null); }} />
                {!preview ? (
                  <button type="button" onClick={check} disabled={pending} className={BTN_MAIN}>たしかめる</button>
                ) : (
                  <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、まとめる</button>
                )}
              </div>
            </>
          )}
          <button type="button" onClick={reset} disabled={pending} className={BTN_SUB}>やめる</button>
          {error && <p className="text-sm font-bold text-red-700">{error}</p>}
        </div>
      )}
      {msg && <p className="mt-2 text-sm font-bold text-navy-700">{msg}</p>}
    </div>
  );
}
