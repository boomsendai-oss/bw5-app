'use client';

// BW6 発表会のスタッフの世帯の画面の「照合を決める」（Task 20・5-8・K226）。照合の確認待ち・合わない人、休会・退会と合った人の横に出す。
// 候補（matchCandidatesAction）と会員を探す欄（18 の searchMembersAction）→ 選ぶ → 理由 → たしかめる（dryRun）で、
// 金額が変わる時は「今の合計 → 結んだあと」、印が残る時は「登録は ◯◯、今は △△」→ 結ぶ。横に「会員ではない」。
// 2段階＋名前を選ぶ（confirm() は使わない）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { MemberLite } from '@/lib/recitalMatch';
import { searchMembersAction } from '../../settings/actions';
import { matchAction, matchCandidatesAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

const FEE_LABEL: Record<string, string> = { no_coop: '協力チケットなし', tshirt_only: 'Tシャツ代だけ', free: '参加費なし' };
const feeLabel = (v: string | null | undefined) => (v ? FEE_LABEL[v] ?? v : 'ふつう');
const MEMBER_STATUS_LABEL: Record<string, string> = { active: '在籍', leave: '休会', withdrew: '退会' };

type Preview = {
  changed: boolean; totalBefore: number; totalAfter: number; refund: number; extra: number; adjustActive: number;
  presetClass: string | null; keptClass: string | null;
};
type Choice = { memberId: number } | { none: true };

export default function MatchPanel(props: { personId: number; personLabel: string }) {
  const { personId, personLabel } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<MemberLite[]>([]);
  const [presets, setPresets] = useState<Record<number, string>>({});
  const [q, setQ] = useState('');
  const [found, setFound] = useState<MemberLite[] | null>(null);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [choiceLabel, setChoiceLabel] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  const openPanel = () => {
    setOpen(true); setMsg(''); setError('');
    startTransition(async () => {
      const r = await matchCandidatesAction(personId);
      setCandidates(r.candidates);
      setPresets(r.presets);
    });
  };
  const reset = () => { setOpen(false); setQ(''); setFound(null); setChoice(null); setChoiceLabel(''); setReason(''); setPreview(null); setError(''); };
  const search = () => {
    startTransition(async () => setFound(await searchMembersAction(q)));
  };
  const choose = (c: Choice, label: string) => { setChoice(c); setChoiceLabel(label); setPreview(null); setError(''); };

  const check = () => {
    if (!choice) { setError('会員を選んでください'); return; }
    if (reason.trim() === '') { setError('理由を入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    startTransition(async () => {
      const r = await matchAction(personId, choice, reason, name, true);
      if (!r.ok) { setError(r.error); return; }
      setPreview(r);
    });
  };
  const go = () => {
    if (!choice) return;
    startTransition(async () => {
      const r = await matchAction(personId, choice, reason, name, false);
      if (!r.ok) { setError(r.error); setPreview(null); return; }
      reset();
      setMsg(r.changed ? `決めました（合計 ${yen(r.totalBefore)} → ${yen(r.totalAfter)}）。` : '決めました。');
      router.refresh();
    });
  };

  const memberRow = (m: MemberLite) => (
    <li key={m.id}>
      <button
        type="button"
        onClick={() => choose({ memberId: m.id }, m.fullName ?? `会員 ${m.id}`)}
        className={`flex w-full flex-wrap gap-x-3 px-3 py-2 text-left text-sm ${choice && 'memberId' in choice && choice.memberId === m.id ? 'bg-brand-50 font-bold' : ''}`}
      >
        <span className="break-words">{m.fullName ?? ''}</span>
        <span className="text-sand-700">{m.fullNameKana ?? ''}</span>
        <span>{m.birthday ?? '生年月日なし'}</span>
        <span className={m.status === 'active' ? '' : 'font-bold text-red-700'}>{MEMBER_STATUS_LABEL[m.status ?? ''] ?? m.status ?? ''}</span>
        {presets[m.id] && <span className="rounded bg-brand-50 px-2 text-brand-700">事前登録：{feeLabel(presets[m.id])}</span>}
      </button>
    </li>
  );

  if (!open) {
    return (
      <div className="mt-2">
        <button type="button" onClick={openPanel} className="rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-navy-700">照合を決める</button>
        {msg && <p className="mt-1 text-sm font-bold text-navy-700">{msg}</p>}
      </div>
    );
  }
  return (
    <div className="mt-2 space-y-3 rounded-lg bg-sand-50 p-3 text-navy-700">
      <h3 className="font-bold">照合を決める（{personLabel}）</h3>
      <div>
        <p className="text-sm font-bold">候補</p>
        {candidates.length === 0 ? (
          <p className="text-sm text-sand-700">{pending ? '読んでいます…' : '候補はありません'}</p>
        ) : (
          <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200 bg-white">{candidates.map(memberRow)}</ul>
        )}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-0 flex-1 text-sm">
          会員を探す（名前かカナ）
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
      {found && found.length === 0 && <p className="text-sm text-sand-700">見つかりません</p>}
      {found && found.length > 0 && <ul className="divide-y divide-sand-100 rounded-lg border border-sand-200 bg-white">{found.map(memberRow)}</ul>}
      <button type="button" onClick={() => choose({ none: true }, '会員ではない')} className={BTN_SUB}>会員ではない</button>
      {choice && <p className="text-sm">選んだもの：<span className="font-bold break-words">{choiceLabel}</span></p>}
      <label className="block text-sm">
        理由（必須）
        <input type="text" value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="例：家庭に確かめた" className={`${RECITAL_INPUT_CLS} mt-1`} />
      </label>
      {preview && (
        <div className="space-y-1 rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-navy-800">
          {preview.totalAfter !== preview.totalBefore && <p className="font-bold">今の合計 {yen(preview.totalBefore)} → 結んだあと {yen(preview.totalAfter)}</p>}
          {preview.refund > 0 && <p>返す分 {yen(preview.refund)}</p>}
          {preview.extra > 0 && <p>追加分 {yen(preview.extra)}</p>}
          {preview.presetClass && preview.keptClass !== preview.presetClass && (
            <p>登録は「{feeLabel(preview.presetClass)}」、今は「{feeLabel(preview.keptClass)}」です（印は変えません。直すときは「特別な料金」で）。</p>
          )}
          {preview.totalAfter === preview.totalBefore && !(preview.presetClass && preview.keptClass !== preview.presetClass) && <p>金額は変わりません。</p>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={(v) => { setName(v); setPreview(null); }} />
        {!preview ? (
          <button type="button" onClick={check} disabled={pending} className={BTN_MAIN}>たしかめる</button>
        ) : (
          <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>{choice && 'none' in choice ? 'はい、会員ではないにする' : 'はい、結ぶ'}</button>
        )}
        <button type="button" onClick={reset} disabled={pending} className={BTN_SUB}>やめる</button>
      </div>
      {error && <p className="text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
