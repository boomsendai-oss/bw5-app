'use client';

// BW6 発表会のスタッフの世帯の画面の、振込の入金の行の横の「この入金を取り消す」（Task 28・D5 2-24。K167・K200・K202）。
// 理由を2つから選ぶ（選ばないと押せない）＋名前を選ぶ＋2段階（confirm() のダイアログは使わない）。
// 取り消してもメールは出ない（おわびは人が書く）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { cancelBankPaymentAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

type Reason = 'wrong_household' | 'misread';
const REASONS: { value: Reason; label: string }[] = [
  { value: 'wrong_household', label: 'ちがう世帯に当てた' },
  { value: 'misread', label: '読みまちがいを直すため（同じ世帯に当て直す）' },
];

export default function CancelPaymentButton(props: { householdId: number; paymentId: number; amount: number }) {
  const { householdId, paymentId, amount } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState<Reason | ''>('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const close = () => { setOpen(false); setConfirming(false); setReason(''); setError(''); };
  const toConfirm = () => {
    if (reason === '') { setError('理由を選んでください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    setConfirming(true);
  };
  const go = () => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('householdId', String(householdId));
      fd.set('paymentId', String(paymentId));
      fd.set('reason', reason);
      fd.set('staffName', name);
      const r = await cancelBankPaymentAction(fd);
      if (!r.ok) { setError(r.error); setConfirming(false); return; }
      close();
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-navy-700">
        この入金を取り消す
      </button>
    );
  }
  return (
    <div className="mt-2 w-full space-y-2 rounded-lg bg-sand-50 p-3 text-navy-700">
      <p className="text-sm font-bold">{yen(amount)}の入金を取り消す</p>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1">理由（必須）</legend>
        {REASONS.map((x) => (
          <label key={x.value} className="flex items-center gap-2">
            <input
              type="radio"
              name={`cancel-reason-${paymentId}`}
              checked={reason === x.value}
              onChange={() => { setReason(x.value); setConfirming(false); }}
              className="h-4 w-4 bg-white text-navy-900 accent-brand-600"
            />
            {x.label}
          </label>
        ))}
      </fieldset>
      {confirming && (
        <p className="rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm font-bold text-navy-800">
          マイナスの行が入り、この世帯の残りがもどります。台帳の行は「見てほしい入金」にもどります。ご家庭へのメールは出ません（おわびは、人が書きます）。
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={(v) => { setName(v); setConfirming(false); }} />
        {!confirming ? (
          <button type="button" onClick={toConfirm} disabled={reason === ''} className={BTN_MAIN}>取り消す</button>
        ) : (
          <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、{yen(amount)}の入金を取り消す</button>
        )}
        <button type="button" onClick={close} disabled={pending} className={BTN_SUB}>やめる</button>
      </div>
      {error && <p className="text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
