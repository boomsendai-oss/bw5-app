'use client';

// ⚠️ 公開ページ(認証なし)。理由: vol.7の観覧チケットのみ購入フォーム(一般来場者向け)。
// vol.6の /bf6/ticket を複製してvol.7に差し替えたもの。
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBf7Context, submitBf7Order, startBf7Checkout, type Bf7PublicContext } from '../order-actions';
import { isValidBf6Email, isValidBf6Phone } from '@/lib/bf6';
import { bf7TicketPayMethodNote, calcBf7OrderTotal, calcBf7TicketUnitPrice, formatJpDate } from '@/lib/bf7Entry';
import { Bf7Card, Bf7Field, Bf7Hero, Bf7NumberSelect, Bf7SectionTitle, Bf7Shell, inputCls, inputClsWith, Bf7PreviewBanner } from '../ui';

const TOKEN_KEY = 'bf7_order_token';
const yen = (n: number) => `¥${n.toLocaleString()}`;

export default function Bf7TicketPage() {
  const router = useRouter();
  const [ctx, setCtx] = useState<Bf7PublicContext | null>(null);
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

  // 欄を離れた時点で形式エラーを赤字表示
  const [blurred, setBlurred] = useState<Record<string, boolean>>({});
  const markBlurred = (key: string) => setBlurred((p) => ({ ...p, [key]: true }));
  const emailError =
    blurred.email && email.trim() && !isValidBf6Email(email) ? 'メールアドレスの形式が正しくありません' : '';
  const phoneError =
    blurred.phone && phone.trim() && !isValidBf6Phone(phone)
      ? '電話番号は数字10〜11桁で入力してください(例: 090-1234-5678)'
      : '';

  useEffect(() => {
    (async () => {
      const c = await getBf7Context();
      setCtx(c);
      if (c.preview) setPayMethod('onsite');
      setLoading(false);
    })();
  }, []);

  const pricing = ctx?.pricing;
  // 前売/当日の切り替えはサーバ基準の日付で行う(端末の時計を信用しない)
  const today = ctx?.today;
  const total = useMemo(() => {
    if (!pricing) return 0;
    return calcBf7OrderTotal({ entries: [], adultTickets, childTickets }, payMethod, pricing, today);
  }, [pricing, today, adultTickets, childTickets, payMethod]);
  const totalOther = useMemo(() => {
    if (!pricing) return 0;
    return calcBf7OrderTotal(
      { entries: [], adultTickets, childTickets },
      payMethod === 'prepaid' ? 'onsite' : 'prepaid',
      pricing,
      today
    );
  }, [pricing, today, adultTickets, childTickets, payMethod]);
  const payNote = useMemo(() => bf7TicketPayMethodNote(pricing, today), [pricing, today]);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    const res = await submitBf7Order({
      buyerName, email, phone, payMethod, entries: [], adultTickets, childTickets,
    });
    if (!res.ok) {
      setSubmitting(false);
      setError(res.error);
      setStep('input');
      return;
    }
    try { localStorage.setItem(TOKEN_KEY, res.token); } catch { /* private mode */ }
    setDoneToken(res.token);
    setAmountTotal(res.amountTotal);
    if (res.payMethod === 'prepaid') {
      // 確認画面の1タップでそのまま決済へ。接続失敗時のみ決済確認ステップに退避
      const co = await startBf7Checkout(res.token);
      if (co.ok) { window.location.href = co.url; return; }
      setSubmitting(false);
      setError(co.error);
      setStep('pay');
      window.scrollTo({ top: 0 });
    } else {
      router.push(`/bf7/complete?t=${res.token}`);
    }
  }

  async function handleGoCheckout() {
    setSubmitting(true);
    setError('');
    const res = await startBf7Checkout(doneToken);
    setSubmitting(false);
    if (res.ok) window.location.href = res.url;
    else setError(res.error);
  }

  if (loading) return <Shell><p className="py-16 text-center text-neutral-400">読み込み中…</p></Shell>;
  if (!ctx || !ctx.ticketOpen) {
    return (
      <Shell>
        <Bf7Hero title="TICKET" subtitle="観覧チケット" />
        <div className="px-4 py-6">
          <Bf7Card>
            <p className="text-neutral-300">
              {ctx && ctx.today < ctx.ticketStart
                ? `観覧チケットの販売は${formatJpDate(ctx.ticketStart)}からです。`
                : '現在観覧チケットの販売は行っていません。'}
            </p>
          </Bf7Card>
        </div>
      </Shell>
    );
  }

  if (step === 'confirm' || step === 'pay') {
    return (
      <Shell preview={ctx.preview}>
        <Bf7Hero
          title={step === 'confirm' ? 'CONFIRM' : 'ONE MORE STEP'}
          subtitle={step === 'confirm' ? '入力内容の確認' : '申込を受け付けました'}
        />
        <div className="space-y-4 px-4 py-6">
          <Bf7Card label="お客様情報">
            <p className="font-bold text-white">{buyerName}</p>
            <p className="text-sm text-neutral-400">{email} / {phone}</p>
          </Bf7Card>
          <Bf7Card label="観覧チケット">
            {adultTickets > 0 && <p className="font-bold text-white">大人 × {adultTickets}</p>}
            {childTickets > 0 && <p className="font-bold text-white">小学生 × {childTickets}</p>}
          </Bf7Card>
          <div className="rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
            <p className="text-xs font-bold tracking-widest text-neutral-400">
              {payMethod === 'prepaid' ? '事前カード決済' : '当日会場でのお支払い(現金)'}
            </p>
            <p className="mt-1 text-4xl font-black text-white">{yen(step === 'pay' ? amountTotal : total)}</p>
          </div>
          {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
          {step === 'confirm' ? (
            <div className="space-y-3 pt-2">
              <button onClick={handleSubmit} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(14,165,233,0.5)] py-4 text-lg font-black disabled:opacity-50">
                {submitting ? (payMethod === 'prepaid' ? '決済画面に接続中…' : '送信中…') : payMethod === 'prepaid' ? `この内容で申し込んで決済に進む(${yen(total)})` : 'この内容で予約する'}
              </button>
              {payMethod === 'prepaid' && (
                <p className="text-center text-xs text-neutral-400">※ このあとカード決済画面(Stripe)に移動します。30分以内の決済完了で確定です</p>
              )}
              <button onClick={() => setStep('input')} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] py-3.5 font-bold opacity-90">
                入力に戻る
              </button>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <p className="text-center text-lg font-black text-white">決済に進みますか?</p>
              <button onClick={handleGoCheckout} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(14,165,233,0.5)] py-4 text-lg font-black disabled:opacity-50">
                {submitting ? '接続中…' : `はい、決済に進む(${yen(amountTotal)})`}
              </button>
              <button onClick={() => router.push(`/bf7/complete?t=${doneToken}`)} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] py-3.5 font-bold opacity-90">
                いいえ、あとで決済する
              </button>
              <p className="text-center text-xs text-neutral-400">※ 30分以内に決済が完了しない場合、この申込は無効になります</p>
            </div>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell preview={ctx.preview}>
      <Bf7Hero title="TICKET" subtitle="観覧チケット / 2027.1.30 SAT — SSM 9階ホール" />
      <div className="px-4 py-6">
        <p className="mb-5 text-xs text-neutral-400">未就学児と出場者本人は無料です。残り{ctx.remaining.tickets}枚</p>

        <section>
          <Bf7SectionTitle no="1" title="お客様情報" />
          <Bf7Card>
            <div className="space-y-4">
              <Bf7Field label="お名前" required>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
              </Bf7Field>
              <Bf7Field label="メールアドレス" required hint="ご予約確認のご連絡が届きます" error={emailError}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markBlurred('email')}
                  className={inputClsWith(emailError)}
                />
              </Bf7Field>
              <Bf7Field label="電話番号" required hint="必ず当日連絡が取れる番号を入力してください" error={phoneError}>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => markBlurred('phone')}
                  className={inputClsWith(phoneError)}
                />
              </Bf7Field>
            </div>
          </Bf7Card>
        </section>

        <section className="mt-8">
          <Bf7SectionTitle no="2" title="枚数" />
          <Bf7Card>
            <div className="grid grid-cols-2 gap-4">
              <Bf7Field label={`大人 ${pricing ? `${yen(calcBf7TicketUnitPrice('ticket_adult', payMethod, pricing, today))}/枚` : ''}`}>
                <Bf7NumberSelect value={adultTickets} onChange={setAdultTickets} />
              </Bf7Field>
              <Bf7Field label={`小学生 ${pricing ? `${yen(calcBf7TicketUnitPrice('ticket_child', payMethod, pricing, today))}/枚` : ''}`}>
                <Bf7NumberSelect value={childTickets} onChange={setChildTickets} />
              </Bf7Field>
            </div>
          </Bf7Card>
        </section>

        <section className="mt-8">
          <Bf7SectionTitle no="3" title="お支払い方法" />
          <div className="space-y-2">
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${payMethod === 'prepaid' ? 'border-sky-600 bg-sky-950/40' : 'border-neutral-800'}`}>
              <input type="radio" checked={payMethod === 'prepaid'} disabled={ctx.preview} onChange={() => setPayMethod('prepaid')} className="h-5 w-5 accent-sky-600" />
              <span className="flex-1">
                <span className="font-black text-white">事前カード決済</span>
                {payNote.discountBadge && (
                  <span className="ml-2 rounded-full bg-sky-600 px-2.5 py-0.5 text-xs font-bold text-white">おトク</span>
                )}
                <span className="block text-xs text-neutral-400">{payNote.prepaid}</span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${payMethod === 'onsite' ? 'border-sky-600 bg-sky-950/40' : 'border-neutral-800'}`}>
              <input type="radio" checked={payMethod === 'onsite'} onChange={() => setPayMethod('onsite')} className="h-5 w-5 accent-sky-600" />
              <span className="font-black text-white">当日会場でお支払い(現金)</span>
            </label>
          </div>
        </section>

        <div className="mt-8 rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
          <p className="text-xs font-bold tracking-widest text-neutral-400">合計金額</p>
          <p className="mt-1 text-5xl font-black text-white">{yen(total)}</p>
          {total !== totalOther && (
            <p className={`mt-2 text-xs font-bold ${payMethod === 'prepaid' ? 'text-sky-400' : 'text-neutral-400'}`}>
              {payMethod === 'prepaid'
                ? `事前決済で ${yen(totalOther - total)} お得になっています(当日払いだと ${yen(totalOther)})`
                : `事前カード決済にすると ${yen(total - totalOther)} お得(合計 ${yen(totalOther)})`}
            </p>
          )}
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}

        <button
          onClick={() => {
            if (!buyerName.trim() || !email.trim() || !phone.trim()) { setError('お名前・メールアドレス・電話番号を入力してください'); return; }
            if (adultTickets + childTickets === 0) { setError('枚数を選んでください'); return; }
            setError('');
            setStep('confirm');
            window.scrollTo({ top: 0 });
          }}
          className="mt-5 w-full rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(14,165,233,0.5)] py-4 text-lg font-black active:scale-[0.99]"
        >
          入力内容を確認する
        </button>

        <p className="mt-5 text-center text-xs text-neutral-400">
          <Link href="/bf7" className="underline">イベント詳細</Link>
          <span className="mx-2">·</span>
          <Link href="/bf7/legal" className="underline">特商法表記・キャンセルポリシー</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children, preview }: { children: React.ReactNode; preview?: boolean }) {
  return (
    <Bf7Shell>
      {preview && <Bf7PreviewBanner />}
      {children}
    </Bf7Shell>
  );
}
