'use client';

// ⚠️ 公開ページ(認証なし)。理由: BF6の観覧チケットのみ購入フォーム(一般来場者向け)。
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBf6Context, submitBf6Order, startBf6Checkout, type Bf6PublicContext } from '../actions';
import { calcOrderTotal, calcTicketUnitPrice } from '@/lib/bf6';

const TOKEN_KEY = 'bf6_order_token';
const yen = (n: number) => `¥${n.toLocaleString()}`;

export default function Bf6TicketPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Bf6PublicContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'input' | 'confirm' | 'pay'>('input');

  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [payMethod, setPayMethod] = useState<'prepaid' | 'onsite'>('prepaid');
  const [adultTickets, setAdultTickets] = useState(1);
  const [childTickets, setChildTickets] = useState(0);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState('');
  const [amountTotal, setAmountTotal] = useState(0);

  useEffect(() => {
    (async () => {
      setCtx(await getBf6Context());
      setLoading(false);
    })();
  }, []);

  const pricing = ctx?.pricing;
  const total = useMemo(() => {
    if (!pricing) return 0;
    return calcOrderTotal({ entries: [], adultTickets, childTickets }, payMethod, pricing);
  }, [pricing, adultTickets, childTickets, payMethod]);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    const res = await submitBf6Order({
      buyerName, email, phone, payMethod, entries: [], adultTickets, childTickets,
    });
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      setStep('input');
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch { /* private mode */ }
    setDoneToken(res.token);
    setAmountTotal(res.amountTotal);
    if (res.payMethod === 'prepaid') setStep('pay');
    else router.push(`/bf6/complete?t=${res.token}`);
  }

  async function handleGoCheckout() {
    setSubmitting(true);
    setError('');
    const res = await startBf6Checkout(doneToken);
    setSubmitting(false);
    if (res.ok) window.location.href = res.url;
    else setError(res.error);
  }

  if (loading) return <Shell><p className="text-zinc-400">読み込み中…</p></Shell>;
  if (!ctx || !ctx.ticketOpen) {
    return (
      <Shell>
        <h1 className="text-2xl font-black text-white">観覧チケット</h1>
        <p className="mt-4 rounded-lg bg-zinc-800 p-4 text-zinc-200">現在観覧チケットの販売は行っていません。</p>
      </Shell>
    );
  }

  if (step === 'confirm' || step === 'pay') {
    return (
      <Shell>
        <h1 className="text-2xl font-black text-white">
          {step === 'confirm' ? '入力内容の確認' : '申込を受け付けました'}
        </h1>
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <p className="text-white">{buyerName}</p>
            <p className="text-sm text-zinc-400">{email} / {phone}</p>
            <p className="mt-2 text-white">
              {adultTickets > 0 && <>大人 × {adultTickets}　</>}
              {childTickets > 0 && <>小学生 × {childTickets}</>}
            </p>
            <p className="mt-2 text-2xl font-black text-red-400">{yen(step === 'pay' ? amountTotal : total)}</p>
            <p className="text-sm text-zinc-400">{payMethod === 'prepaid' ? '事前カード決済' : '当日会場でのお支払い(現金)'}</p>
          </div>
        </div>
        {error && <p className="mt-4 rounded-lg bg-red-900/40 p-3 text-red-300">{error}</p>}
        {step === 'confirm' ? (
          <div className="mt-6 space-y-3">
            <button onClick={handleSubmit} disabled={submitting} className="w-full rounded-xl bg-red-600 py-4 text-lg font-black text-white disabled:opacity-50">
              {submitting ? '送信中…' : payMethod === 'prepaid' ? 'この内容で申し込む(次で決済)' : 'この内容で予約する'}
            </button>
            <button onClick={() => setStep('input')} disabled={submitting} className="w-full rounded-xl border border-zinc-600 py-3 text-zinc-300">
              入力に戻る
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-center font-bold text-white">決済に進みますか?</p>
            <button onClick={handleGoCheckout} disabled={submitting} className="w-full rounded-xl bg-red-600 py-4 text-lg font-black text-white disabled:opacity-50">
              {submitting ? '接続中…' : `はい、決済に進む(${yen(amountTotal)})`}
            </button>
            <button onClick={() => router.push(`/bf6/complete?t=${doneToken}`)} disabled={submitting} className="w-full rounded-xl border border-zinc-600 py-3 text-zinc-300">
              いいえ、あとで決済する
            </button>
            <p className="text-center text-xs text-zinc-500">※ 30分以内に決済が完了しない場合、この申込は無効になります</p>
          </div>
        )}
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-2xl font-black text-white">観覧チケット購入</h1>
      <p className="mt-1 text-sm text-zinc-400">BOOMER&apos;S FIGHT!!! vol.6 — 2026.9.26(土) SSM 9階ホール</p>
      <p className="mt-2 text-xs text-zinc-500">未就学児と出場者本人は無料です。残り{ctx.remaining.tickets}枚</p>

      <div className="mt-6 space-y-3">
        <Field label="お名前" required><input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} /></Field>
        <Field label="メールアドレス" required><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></Field>
        <Field label="電話番号" required hint="必ず当日連絡が取れる番号を入力してください">
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`大人 ${pricing ? `(${yen(calcTicketUnitPrice('ticket_adult', payMethod, pricing))}/枚)` : ''}`}>
            <NumberSelect value={adultTickets} onChange={setAdultTickets} />
          </Field>
          <Field label={`小学生 ${pricing ? `(${yen(calcTicketUnitPrice('ticket_child', payMethod, pricing))}/枚)` : ''}`}>
            <NumberSelect value={childTickets} onChange={setChildTickets} />
          </Field>
        </div>
        <div className="space-y-2">
          <label className={`flex items-center gap-3 rounded-lg border p-3 ${payMethod === 'prepaid' ? 'border-red-500 bg-red-950/40' : 'border-zinc-700'}`}>
            <input type="radio" checked={payMethod === 'prepaid'} onChange={() => setPayMethod('prepaid')} />
            <span className="font-bold text-white">事前カード決済 <span className="ml-1 rounded bg-red-600 px-2 py-0.5 text-xs">大人¥500引き</span></span>
          </label>
          <label className={`flex items-center gap-3 rounded-lg border p-3 ${payMethod === 'onsite' ? 'border-red-500 bg-red-950/40' : 'border-zinc-700'}`}>
            <input type="radio" checked={payMethod === 'onsite'} onChange={() => setPayMethod('onsite')} />
            <span className="font-bold text-white">当日会場でお支払い(現金)</span>
          </label>
        </div>
      </div>

      <section className="mt-6 rounded-xl bg-zinc-800 p-4 text-center">
        <p className="text-sm text-zinc-400">合計金額</p>
        <p className="text-4xl font-black text-red-400">{yen(total)}</p>
      </section>

      {error && <p className="mt-4 rounded-lg bg-red-900/40 p-3 text-red-300">{error}</p>}

      <button
        onClick={() => {
          if (!buyerName.trim() || !email.trim() || !phone.trim()) { setError('お名前・メールアドレス・電話番号を入力してください'); return; }
          if (adultTickets + childTickets === 0) { setError('枚数を選んでください'); return; }
          setError('');
          setStep('confirm');
          window.scrollTo({ top: 0 });
        }}
        className="mt-6 w-full rounded-xl bg-red-600 py-4 text-lg font-black text-white"
      >
        入力内容を確認する
      </button>

      <p className="mt-4 text-center text-xs text-zinc-500">
        <Link href="/bf6" className="underline">イベント詳細へ</Link> ・ <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
      </p>
    </Shell>
  );
}

const inputCls =
  'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-white placeholder-zinc-600 focus:border-red-500 focus:outline-none';

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-8">{children}</div>
    </div>
  );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-bold text-zinc-300">{label} {required && <span className="text-red-400">*</span>}</span>
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

function NumberSelect({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={inputCls}>
      {Array.from({ length: 11 }, (_, n) => (
        <option key={n} value={n}>{n}枚</option>
      ))}
    </select>
  );
}
