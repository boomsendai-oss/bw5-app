'use client';

// BW6 発表会のスタッフの世帯の画面のお金のボタン：「手で入金を記録」（現金／調整）と、返す分の行の「返す分を取り消す」。
// 振込は選べない（「見てほしい入金」から当てる）。入金の記録は消さない。まちがいはマイナスの調整で打ち消す（5-6）。
// 2段階＋名前を選ぶ（confirm() のダイアログは使わない）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { cancelRefundAction, recordManualPaymentAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

const PAID_MAIL_NAME: Record<string, string> = {
  complete: '「申込完了」',
  extra_complete: '「追加分のお支払い完了」',
  remaining: '「あと◯円のお知らせ」',
};
const PAID_MAIL_STATUS: Record<string, string> = {
  waiting: '待ち（あとで送られます）',
  failed: '失敗（送れませんでした）',
  duplicate: '重複（もう送ってあります）',
};

/** 入金のあとのメールの結果の文。「送りました」と言うのは sent の時だけ */
function paidMailText(mail: { kind: string; status: string } | null): string {
  if (!mail) return '';
  const name = PAID_MAIL_NAME[mail.kind] ?? mail.kind;
  if (mail.status === 'sent') return `${name}のメールを送りました。`;
  return `${name}のメール：${PAID_MAIL_STATUS[mail.status] ?? mail.status}`;
}

/** 金額の欄の字 → 整数（調整はマイナスも）。読めなければ NaN */
function parseAmount(s: string): number {
  const t = s.normalize('NFKC').replace(/[,\s円]/g, '');
  return /^-?\d+$/.test(t) ? Number(t) : NaN;
}

export default function MoneyButtons(props: { householdId: number; remaining: number; today: string }) {
  const { householdId, remaining, today } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState<'cash' | 'adjust'>('cash');
  const [paidOn, setPaidOn] = useState(today);
  const [amountText, setAmountText] = useState('');
  const [memo, setMemo] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();

  const amount = parseAmount(amountText);
  const partial = Number.isInteger(amount) && amount > 0 && amount < remaining;
  const edit = <T,>(set: (v: T) => void) => (v: T) => { set(v); setConfirming(false); };
  const reset = () => {
    setOpen(false); setConfirming(false); setMethod('cash'); setPaidOn(today); setAmountText(''); setMemo(''); setError('');
  };

  const toConfirm = () => {
    if (!Number.isInteger(amount)) { setError('金額を整数で入れてください'); return; }
    if (method === 'cash' && amount < 1) { setError('現金は1円以上で入れてください'); return; }
    if (method === 'adjust' && amount === 0) { setError('調整は0でない金額を入れてください'); return; }
    if (paidOn === '' || paidOn > today) { setError('日を確かめてください（先の日は入れられません）'); return; }
    if (method === 'adjust' && memo.trim() === '') { setError('調整はメモを入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    setConfirming(true);
  };

  const go = () => {
    startTransition(async () => {
      const r = await recordManualPaymentAction(householdId, { method, amount, paidOn, memo }, name);
      if (!r.ok) { setError(r.error); setConfirming(false); return; }
      reset();
      setMsg(`記録しました。${paidMailText(r.mail)}`);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3 text-navy-700">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className={BTN_SUB}>手で入金を記録</button>
      ) : (
        <div className="space-y-3">
          <h3 className="font-bold">手で入金を記録</h3>
          <p className="text-xs text-sand-700">振込は『見てほしい入金』から当てます（ここでは選べません）。</p>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="sr-only">払い方</legend>
            {(['cash', 'adjust'] as const).map((m) => (
              <label key={m} className="flex items-center gap-2">
                <input type="radio" name="manual-method" checked={method === m} onChange={() => edit(setMethod)(m)} className="h-4 w-4 accent-brand-600" />
                {m === 'cash' ? '現金' : '調整'}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              日
              <input type="date" value={paidOn} max={today} onChange={(e) => edit(setPaidOn)(e.target.value)} className={`${RECITAL_INPUT_CLS} mt-1`} />
            </label>
            <label className="block text-sm">
              金額（円）
              <input
                type="text"
                inputMode={method === 'adjust' ? 'text' : 'numeric'}
                value={amountText}
                onChange={(e) => edit(setAmountText)(e.target.value)}
                placeholder={method === 'adjust' ? '例：-26500' : '例：26500'}
                className={`${RECITAL_INPUT_CLS} mt-1`}
              />
            </label>
          </div>
          {method === 'adjust' && <p className="text-xs text-sand-700">打ちまちがいは、同じ額をマイナスで入れて打ち消します。</p>}
          <label className="block text-sm">
            メモ{method === 'adjust' ? '（調整は必須）' : '（任意）'}
            <input type="text" value={memo} onChange={(e) => edit(setMemo)(e.target.value)} className={`${RECITAL_INPUT_CLS} mt-1`} />
          </label>
          {partial && (
            <p className="rounded-lg border border-sand-300 bg-sand-50 px-3 py-2 text-sm font-bold text-navy-800">
              一部だけの入金です。ご家庭には『追加分 {yen(remaining - amount)}のお支払い待ち』と出ます。
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={edit(setName)} />
            {!confirming ? (
              <button type="button" onClick={toConfirm} className={BTN_MAIN}>記録する</button>
            ) : (
              <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>
                はい、{method === 'cash' ? '現金' : '調整'} {yen(amount)}を記録する
              </button>
            )}
            <button type="button" onClick={reset} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
      {msg && <p className="mt-2 text-sm font-bold text-navy-700">{msg}</p>}
    </div>
  );
}

/** 返す分（todo）の行の横の「返す分を取り消す」。理由必須・名前・2段階 */
export function RefundCancelButton({ householdId, refundId }: { householdId: number; refundId: number }) {
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
      const r = await cancelRefundAction(householdId, refundId, reason, name);
      if (!r.ok) { setError(r.error); setConfirming(false); return; }
      close();
      router.refresh();
    });
  };
  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-sand-300 bg-white px-3 py-1 text-sm text-navy-700">返す分を取り消す</button>;
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
          <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、この返す分を取り消す</button>
        )}
        <button type="button" onClick={close} disabled={pending} className={BTN_SUB}>やめる</button>
      </div>
      {error && <p className="text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
