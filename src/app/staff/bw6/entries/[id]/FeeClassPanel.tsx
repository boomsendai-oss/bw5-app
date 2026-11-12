'use client';

// BW6 発表会のスタッフの世帯の画面の「特別な料金」（Task 20・K223・K227・K228）。
// 人を選ぶ → 種類（ふつう／協力チケットなし／Tシャツ代だけ／参加費なし）と理由 → 「たしかめる」で本番と同じ計算の結果（dryRun）を出す → 「直す」。
// 金額は打たせない（種類を選ぶだけ）。中に、たたんだ「そのほかの金額の直し」（3つの種類の外の額だけ。下げる／上げる・金額・理由）と、
// 生きている手の調整の行の「取り消す」（理由必須）。2段階＋名前を選ぶ（confirm() は使わない）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import type { FeeClass } from '@/lib/recital';
import { adjustAction, feeClassAction, voidAdjustAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

const FEE_OPTIONS: { value: FeeClass; label: string }[] = [
  { value: null, label: 'ふつう' },
  { value: 'no_coop', label: '協力チケットなし' },
  { value: 'tshirt_only', label: 'Tシャツ代だけ' },
  { value: 'free', label: '参加費なし' },
];
const feeLabel = (v: FeeClass) => FEE_OPTIONS.find((o) => o.value === v)?.label ?? 'ふつう';

export type FeePanelPerson = { id: number; name: string; feeClass: FeeClass };
export type AdjustRow = { id: number; amount: number; reason: string };

type FeePreview = { changed: boolean; totalBefore: number; totalAfter: number; refund: number; extra: number; adjustActive: number };

/** 金額の欄の字 → 1以上の整数。読めなければ NaN */
function parsePositive(s: string): number {
  const t = s.normalize('NFKC').replace(/[,\s円]/g, '');
  return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : NaN;
}

export default function FeeClassPanel(props: { householdId: number; people: FeePanelPerson[]; adjusts: AdjustRow[]; rowsBelowZero: boolean }) {
  const { householdId, people, adjusts, rowsBelowZero } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [personId, setPersonId] = useState<number>(people[0]?.id ?? 0);
  const [feeClass, setFeeClassValue] = useState<FeeClass>(people[0]?.feeClass ?? null);
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<FeePreview | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  const person = people.find((p) => p.id === personId);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); };
  const reset = () => { setOpen(false); setReason(''); setPreview(null); setError(''); };

  const check = () => {
    if (!person) { setError('人を選んでください'); return; }
    if (reason.trim() === '') { setError('理由を入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    startTransition(async () => {
      const r = await feeClassAction(personId, feeClass, reason, name, true);
      if (!r.ok) { setError(r.error); return; }
      setPreview(r);
    });
  };
  const go = () => {
    startTransition(async () => {
      const r = await feeClassAction(personId, feeClass, reason, name, false);
      if (!r.ok) { setError(r.error); setPreview(null); return; }
      reset();
      setMsg(r.changed ? `直しました（合計 ${yen(r.totalBefore)} → ${yen(r.totalAfter)}）。` : '今と同じ種類なので、変えませんでした。');
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3 text-navy-700">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className={BTN_SUB}>特別な料金</button>
      ) : (
        <div className="space-y-3">
          <h3 className="font-bold">特別な料金</h3>
          <p className="text-xs text-sand-700">金額は打ちません。種類を選ぶと、しくみが請求を作り直します。</p>
          <label className="block text-sm">
            人
            <select
              value={personId}
              onChange={(e) => {
                const id = Number(e.target.value);
                setPersonId(id);
                setFeeClassValue(people.find((p) => p.id === id)?.feeClass ?? null);
                setPreview(null);
              }}
              className={`${RECITAL_INPUT_CLS} mt-1`}
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}（今：{feeLabel(p.feeClass)}）</option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 w-full">種類</legend>
            {FEE_OPTIONS.map((o) => (
              <label key={String(o.value)} className="flex items-center gap-2">
                <input type="radio" name="fee-class" checked={feeClass === o.value} onChange={() => edit(setFeeClassValue)(o.value)} className="h-4 w-4 accent-brand-600" />
                {o.label}
              </label>
            ))}
          </fieldset>
          <label className="block text-sm">
            理由（必須）
            <input type="text" value={reason} onChange={(e) => edit(setReason)(e.target.value)} placeholder="例：事前登録のもれ" className={`${RECITAL_INPUT_CLS} mt-1`} />
          </label>
          {preview && (
            <div className="space-y-1 rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm text-navy-800">
              {!preview.changed ? (
                <p className="font-bold">今と同じ種類です（変わりません）。</p>
              ) : (
                <>
                  <p className="font-bold">今の合計 {yen(preview.totalBefore)} → 直したあと {yen(preview.totalAfter)}</p>
                  {preview.refund > 0 && <p>返す分 {yen(preview.refund)}（「返す分」に出ます）</p>}
                  {preview.extra > 0 && <p>追加分 {yen(preview.extra)}</p>}
                  {preview.totalAfter > preview.totalBefore && (
                    <p className="font-bold text-red-700">押す前に、公式LINEで家庭に一言伝えてください。</p>
                  )}
                </>
              )}
              {preview.adjustActive !== 0 && <p>手の調整 {yen(preview.adjustActive)}があります。</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={edit(setName)} />
            {!preview ? (
              <button type="button" onClick={check} disabled={pending} className={BTN_MAIN}>たしかめる</button>
            ) : preview.changed ? (
              <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、「{feeLabel(feeClass)}」に直す</button>
            ) : null}
            <button type="button" onClick={reset} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
          {error && <p className="text-sm font-bold text-red-700">{error}</p>}

          <details className="rounded-lg border border-sand-200 p-3">
            <summary className="cursor-pointer text-sm font-bold">そのほかの金額の直し</summary>
            <div className="mt-3 space-y-3">
              <p className="text-xs text-sand-700">3つの種類で直せない額だけに使います。合計は 0円より下げられません。</p>
              {rowsBelowZero && <p className="text-sm font-bold text-navy-800">行の合計が 0 より小さいので、合計は 0 と数えています。</p>}
              {adjusts.length > 0 && (
                <ul className="divide-y divide-sand-100">
                  {adjusts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className="font-bold">{yen(a.amount)}</span>
                      <span className="min-w-0 break-words text-sand-700">{a.reason}</span>
                      <AdjustVoidButton householdId={householdId} chargeId={a.id} />
                    </li>
                  ))}
                </ul>
              )}
              <AdjustAdd householdId={householdId} />
            </div>
          </details>
        </div>
      )}
      {msg && <p className="mt-2 text-sm font-bold text-navy-700">{msg}</p>}
    </div>
  );
}

/** 手の調整を足す。下げる／上げる・金額・理由 → たしかめる（dryRun）→ 足す */
function AdjustAdd({ householdId }: { householdId: number }) {
  const router = useRouter();
  const [direction, setDirection] = useState<'down' | 'up'>('down');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [preview, setPreview] = useState<{ totalBefore: number; totalAfter: number } | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();
  const amount = parsePositive(amountText);
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPreview(null); };

  const check = () => {
    if (!Number.isInteger(amount)) { setError('金額は1円以上の整数で入れてください'); return; }
    if (reason.trim() === '') { setError('理由を入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    setMsg('');
    startTransition(async () => {
      const r = await adjustAction(householdId, { direction, amount, reason }, name, true);
      if (!r.ok) { setError(r.error); return; }
      setPreview(r);
    });
  };
  const go = () => {
    startTransition(async () => {
      const r = await adjustAction(householdId, { direction, amount, reason }, name, false);
      if (!r.ok) { setError(r.error); setPreview(null); return; }
      setPreview(null); setAmountText(''); setReason('');
      setMsg(`足しました（合計 ${yen(r.totalBefore)} → ${yen(r.totalAfter)}）。`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-3 rounded-lg bg-sand-50 p-3">
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">下げる・上げる</legend>
        {(['down', 'up'] as const).map((d) => (
          <label key={d} className="flex items-center gap-2">
            <input type="radio" name="adjust-direction" checked={direction === d} onChange={() => edit(setDirection)(d)} className="h-4 w-4 accent-brand-600" />
            {d === 'down' ? '下げる' : '上げる'}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          金額（円）
          <input type="text" inputMode="numeric" value={amountText} onChange={(e) => edit(setAmountText)(e.target.value)} placeholder="例：1000" className={`${RECITAL_INPUT_CLS} mt-1`} />
        </label>
        <label className="block text-sm">
          理由（必須）
          <input type="text" value={reason} onChange={(e) => edit(setReason)(e.target.value)} className={`${RECITAL_INPUT_CLS} mt-1`} />
        </label>
      </div>
      {preview && (
        <p className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm font-bold text-navy-800">
          今の合計 {yen(preview.totalBefore)} → 直したあと {yen(preview.totalAfter)}
          {preview.totalAfter > preview.totalBefore && <span className="mt-1 block text-red-700">押す前に、公式LINEで家庭に一言伝えてください。</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={edit(setName)} />
        {!preview ? (
          <button type="button" onClick={check} disabled={pending} className={BTN_MAIN}>たしかめる</button>
        ) : (
          <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、{direction === 'down' ? '下げる' : '上げる'} {yen(amount)}を足す</button>
        )}
      </div>
      {error && <p className="text-sm font-bold text-red-700">{error}</p>}
      {msg && <p className="text-sm font-bold text-navy-700">{msg}</p>}
    </div>
  );
}

/** 手の調整の行の「取り消す」。理由必須・名前・2段階 */
function AdjustVoidButton({ householdId, chargeId }: { householdId: number; chargeId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const close = () => { setOpen(false); setConfirming(false); setReason(''); setError(''); };
  const toConfirm = () => {
    if (reason.trim() === '') { setError('理由を入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    setConfirming(true);
  };
  const go = () => {
    startTransition(async () => {
      const r = await voidAdjustAction(householdId, chargeId, reason, name);
      if (!r.ok) { setError(r.error); setConfirming(false); return; }
      close();
      router.refresh();
    });
  };
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-navy-700">取り消す</button>;
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-lg bg-sand-50 p-3">
      <label className="block text-sm text-navy-700">
        理由（必須）
        <input type="text" value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} className={`${RECITAL_INPUT_CLS} mt-1`} />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={(v) => { setName(v); setConfirming(false); }} />
        {!confirming ? (
          <button type="button" onClick={toConfirm} className={BTN_MAIN}>取り消す</button>
        ) : (
          <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、この調整を取り消す</button>
        )}
        <button type="button" onClick={close} disabled={pending} className={BTN_SUB}>やめる</button>
      </div>
      {error && <p className="text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
