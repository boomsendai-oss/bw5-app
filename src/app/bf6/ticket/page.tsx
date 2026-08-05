'use client';

// ⚠️ 公開ページ(認証なし)。理由: BF6の観覧チケットのみ購入フォーム(一般来場者向け)。
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getBf6Context, submitBf6Order, startBf6Checkout, type Bf6PublicContext } from '../actions';
import { calcOrderTotal, calcTicketUnitPrice, isValidBf6Email, isValidBf6Phone } from '@/lib/bf6';
import { Bf6Card, Bf6Field, Bf6Hero, Bf6NumberSelect, Bf6SectionTitle, Bf6Shell, inputCls, inputClsWith } from '../ui';

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
      setCtx(await getBf6Context());
      setLoading(false);
    })();
  }, []);

  const pricing = ctx?.pricing;
  const total = useMemo(() => {
    if (!pricing) return 0;
    return calcOrderTotal({ entries: [], adultTickets, childTickets }, payMethod, pricing);
  }, [pricing, adultTickets, childTickets, payMethod]);
  const totalOther = useMemo(() => {
    if (!pricing) return 0;
    return calcOrderTotal(
      { entries: [], adultTickets, childTickets },
      payMethod === 'prepaid' ? 'onsite' : 'prepaid',
      pricing
    );
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
    if (res.payMethod === 'prepaid') {
      setStep('pay');
      window.scrollTo({ top: 0 });
    } else {
      router.push(`/bf6/complete?t=${res.token}`);
    }
  }

  async function handleGoCheckout() {
    setSubmitting(true);
    setError('');
    const res = await startBf6Checkout(doneToken);
    setSubmitting(false);
    if (res.ok) window.location.href = res.url;
    else setError(res.error);
  }

  if (loading) return <Shell><p className="py-16 text-center text-neutral-400">読み込み中…</p></Shell>;
  if (!ctx || !ctx.ticketOpen) {
    return (
      <Shell>
        <Bf6Hero title="TICKET" subtitle="観覧チケット" />
        <div className="px-4 py-6">
          <Bf6Card><p className="text-neutral-300">現在観覧チケットの販売は行っていません。</p></Bf6Card>
        </div>
      </Shell>
    );
  }

  if (step === 'confirm' || step === 'pay') {
    return (
      <Shell>
        <Bf6Hero
          title={step === 'confirm' ? 'CONFIRM' : 'ONE MORE STEP'}
          subtitle={step === 'confirm' ? '入力内容の確認' : '申込を受け付けました'}
        />
        <div className="space-y-4 px-4 py-6">
          <Bf6Card label="お客様情報">
            <p className="font-bold text-white">{buyerName}</p>
            <p className="text-sm text-neutral-400">{email} / {phone}</p>
          </Bf6Card>
          <Bf6Card label="観覧チケット">
            {adultTickets > 0 && <p className="font-bold text-white">大人 × {adultTickets}</p>}
            {childTickets > 0 && <p className="font-bold text-white">小学生 × {childTickets}</p>}
          </Bf6Card>
          <div className="rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
            <p className="text-xs font-bold tracking-widest text-neutral-400">
              {payMethod === 'prepaid' ? '事前カード決済' : '当日会場でのお支払い(現金)'}
            </p>
            <p className="mt-1 text-4xl font-black text-white">{yen(step === 'pay' ? amountTotal : total)}</p>
          </div>
          {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
          {step === 'confirm' ? (
            <div className="space-y-3 pt-2">
              <button onClick={handleSubmit} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black disabled:opacity-50">
                {submitting ? '送信中…' : payMethod === 'prepaid' ? 'この内容で申し込む(次で決済)' : 'この内容で予約する'}
              </button>
              <button onClick={() => setStep('input')} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] py-3.5 font-bold opacity-90">
                入力に戻る
              </button>
            </div>
          ) : (
            <div className="space-y-3 pt-2">
              <p className="text-center text-lg font-black text-white">決済に進みますか?</p>
              <button onClick={handleGoCheckout} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black disabled:opacity-50">
                {submitting ? '接続中…' : `はい、決済に進む(${yen(amountTotal)})`}
              </button>
              <button onClick={() => router.push(`/bf6/complete?t=${doneToken}`)} disabled={submitting} className="w-full rounded-2xl bg-gradient-to-b from-neutral-700 via-neutral-800 to-black text-white ring-1 ring-neutral-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_10px_25px_-5px_rgba(0,0,0,0.6)] py-3.5 font-bold opacity-90">
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
    <Shell>
      <Bf6Hero title="TICKET" subtitle="観覧チケット / 2026.9.26 SAT — SSM 9階ホール" />
      <div className="px-4 py-6">
        <p className="mb-5 text-xs text-neutral-400">未就学児と出場者本人は無料です。残り{ctx.remaining.tickets}枚</p>

        <section>
          <Bf6SectionTitle no="1" title="お客様情報" />
          <Bf6Card>
            <div className="space-y-4">
              <Bf6Field label="お名前" required>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
              </Bf6Field>
              <Bf6Field label="メールアドレス" required hint="ご予約確認のご連絡が届きます" error={emailError}>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => markBlurred('email')}
                  className={inputClsWith(emailError)}
                />
              </Bf6Field>
              <Bf6Field label="電話番号" required hint="必ず当日連絡が取れる番号を入力してください" error={phoneError}>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onBlur={() => markBlurred('phone')}
                  className={inputClsWith(phoneError)}
                />
              </Bf6Field>
            </div>
          </Bf6Card>
        </section>

        <section className="mt-8">
          <Bf6SectionTitle no="2" title="枚数" />
          <Bf6Card>
            <div className="grid grid-cols-2 gap-4">
              <Bf6Field label={`大人 ${pricing ? `${yen(calcTicketUnitPrice('ticket_adult', payMethod, pricing))}/枚` : ''}`}>
                <Bf6NumberSelect value={adultTickets} onChange={setAdultTickets} />
              </Bf6Field>
              <Bf6Field label={`小学生 ${pricing ? `${yen(calcTicketUnitPrice('ticket_child', payMethod, pricing))}/枚` : ''}`}>
                <Bf6NumberSelect value={childTickets} onChange={setChildTickets} />
              </Bf6Field>
            </div>
          </Bf6Card>
        </section>

        <section className="mt-8">
          <Bf6SectionTitle no="3" title="お支払い方法" />
          <div className="space-y-2">
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${payMethod === 'prepaid' ? 'border-red-600 bg-red-950/40' : 'border-neutral-800'}`}>
              <input type="radio" checked={payMethod === 'prepaid'} onChange={() => setPayMethod('prepaid')} className="h-5 w-5 accent-red-600" />
              <span className="flex-1">
                <span className="font-black text-white">事前カード決済</span>
                <span className="ml-2 rounded-full bg-red-600 px-2.5 py-0.5 text-xs font-bold text-white">おトク</span>
                <span className="block text-xs text-neutral-400">
                  大人は¥2,000(当日現金だと¥2,500)。小学生は一律¥1,000(割引対象外)
                </span>
              </span>
            </label>
            <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 bg-neutral-900 p-4 ${payMethod === 'onsite' ? 'border-red-600 bg-red-950/40' : 'border-neutral-800'}`}>
              <input type="radio" checked={payMethod === 'onsite'} onChange={() => setPayMethod('onsite')} className="h-5 w-5 accent-red-600" />
              <span className="font-black text-white">当日会場でお支払い(現金)</span>
            </label>
          </div>
        </section>

        <div className="mt-8 rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
          <p className="text-xs font-bold tracking-widest text-neutral-400">合計金額</p>
          <p className="mt-1 text-5xl font-black text-white">{yen(total)}</p>
          {total !== totalOther && (
            <p className={`mt-2 text-xs font-bold ${payMethod === 'prepaid' ? 'text-red-400' : 'text-neutral-400'}`}>
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
          className="mt-5 w-full rounded-2xl bg-gradient-to-b from-red-500 via-red-600 to-red-800 text-white ring-1 ring-red-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(220,38,38,0.5)] py-4 text-lg font-black active:scale-[0.99]"
        >
          入力内容を確認する
        </button>

        <p className="mt-5 text-center text-xs text-neutral-400">
          <Link href="/bf6" className="underline">イベント詳細</Link>
          <span className="mx-2">·</span>
          <Link href="/bf6/legal" className="underline">特商法表記・キャンセルポリシー</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <Bf6Shell>{children}</Bf6Shell>;
}
