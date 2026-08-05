'use client';

// ⚠️ 公開ページ(認証なし)。理由: BF6オンライン配信チケットの販売LP(一般向け)。
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { submitBf6Order, startBf6Checkout } from '../actions';
import { getBf6StreamContext, type Bf6StreamContext } from './actions';
import { isValidBf6Email, isValidBf6Phone } from '@/lib/bf6';
import { Bf6Card, Bf6Field, Bf6Hero, Bf6SectionTitle, Bf6Shell, btnPrimaryCls, inputCls, inputClsWith } from '../ui';

const TOKEN_KEY = 'bf6_order_token';
const yen = (n: number) => `¥${n.toLocaleString()}`;

export default function Bf6StreamPage() {
  const [ctx, setCtx] = useState<Bf6StreamContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'input' | 'confirm' | 'pay'>('input');

  const [buyerName, setBuyerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [qty, setQty] = useState(1);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState('');
  const [amountTotal, setAmountTotal] = useState(0);

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
      setCtx(await getBf6StreamContext());
      setLoading(false);
    })();
  }, []);

  const total = useMemo(() => (ctx ? ctx.price * qty : 0), [ctx, qty]);

  async function handleSubmit() {
    setSubmitting(true);
    setError('');
    const res = await submitBf6Order({
      buyerName, email, phone,
      payMethod: 'prepaid',
      entries: [],
      adultTickets: 0,
      childTickets: 0,
      streamTickets: qty,
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
    // 確認画面の1タップでそのまま決済へ。接続失敗時のみ決済確認ステップに退避
    const co = await startBf6Checkout(res.token);
    if (co.ok) { window.location.href = co.url; return; }
    setSubmitting(false);
    setError(co.error);
    setStep('pay');
    window.scrollTo({ top: 0 });
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
  if (!ctx || !ctx.open) {
    return (
      <Shell>
        <Bf6Hero title="STREAMING" subtitle="オンライン配信" />
        <div className="px-4 py-6">
          <Bf6Card>
            <p className="text-neutral-300">オンライン配信チケットの販売は準備中です。発表をお待ちください!</p>
          </Bf6Card>
          <p className="mt-6 text-center text-sm">
            <Link href="/bf6" className="font-bold text-red-400 underline">イベントページに戻る</Link>
          </p>
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
          {step === 'pay' && (
            <>
              <p className="rounded-xl border-2 border-red-600 bg-red-950/40 p-4 text-sm font-bold text-red-300">
                決済が完了すると、視聴キーがメールで届きます。
              </p>
              {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
              <div className="space-y-3 rounded-2xl border-2 border-red-600 bg-neutral-900 p-4">
                <p className="text-center text-lg font-black text-white">決済に進みますか?</p>
                <button
                  onClick={handleGoCheckout}
                  disabled={submitting}
                  className={`w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] disabled:opacity-50 ${btnPrimaryCls}`}
                >
                  {submitting ? '接続中…' : `はい、決済に進む(${yen(amountTotal)})`}
                </button>
                <p className="text-center text-xs text-neutral-400">※ 30分以内に決済が完了しない場合、この申込は無効になります</p>
              </div>
            </>
          )}
          <Bf6Card label="お客様情報">
            <p className="font-bold text-white">{buyerName}</p>
            <p className="text-sm text-neutral-400">{email} / {phone}</p>
          </Bf6Card>
          <Bf6Card label="オンライン配信視聴チケット">
            <p className="font-bold text-white">{qty}枚 × {yen(ctx.price)}</p>
            <p className="mt-1 text-xs text-neutral-400">1枚につき同時視聴1端末。ご家族で別々に観る場合は枚数分ご購入ください</p>
          </Bf6Card>
          <div className="rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
            <p className="text-xs font-bold tracking-widest text-neutral-400">合計(事前カード決済)</p>
            <p className="mt-1 text-4xl font-black text-white">{yen(step === 'pay' ? amountTotal : total)}</p>
          </div>
          {step === 'confirm' && (
            <>
              {error && <p className="rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}
              <div className="space-y-3 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  className={`w-full rounded-2xl py-4 text-lg font-black disabled:opacity-50 ${btnPrimaryCls}`}
                >
                  {submitting ? '決済画面に接続中…' : `この内容で申し込んで決済に進む(${yen(total)})`}
                </button>
                <p className="text-center text-xs text-neutral-400">※ このあとカード決済画面(Stripe)に移動します。30分以内の決済完了で確定です</p>
                <button onClick={() => setStep('input')} disabled={submitting} className="w-full rounded-2xl border-2 border-neutral-700 bg-neutral-900 py-3.5 font-bold text-neutral-400">
                  入力に戻る
                </button>
              </div>
            </>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Bf6Hero title="STREAMING" subtitle="オンライン配信チケット / 2026.9.26 SAT LIVE" />
      <div className="px-4 py-6">
        <Bf6Card label="オンライン配信について">
          <ul className="space-y-1.5 text-sm text-neutral-300">
            <li>・当日のバトル&ショーケースをスマホ/PCからライブ視聴できます</li>
            <li>・購入すると<span className="font-bold text-white">視聴キーがメールで届きます</span></li>
            <li>・配信終了後も<span className="font-bold text-white">1週間アーカイブ視聴OK</span></li>
            <li>・1キーにつき同時視聴は1端末まで</li>
            <li className="text-xs text-neutral-400">※ 視聴者様の通信環境による視聴不良は返金対象外です</li>
          </ul>
        </Bf6Card>

        <section className="mt-6">
          <Bf6SectionTitle no="1" title="お客様情報" />
          <Bf6Card>
            <div className="space-y-4">
              <Bf6Field label="お名前" required>
                <input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputCls} />
              </Bf6Field>
              <Bf6Field label="メールアドレス" required hint="視聴キーがこのアドレスに届きます" error={emailError}>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => markBlurred('email')} className={inputClsWith(emailError)} />
              </Bf6Field>
              <Bf6Field label="電話番号" required error={phoneError}>
                <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} onBlur={() => markBlurred('phone')} className={inputClsWith(phoneError)} />
              </Bf6Field>
            </div>
          </Bf6Card>
        </section>

        <section className="mt-6">
          <Bf6SectionTitle no="2" title="枚数" note={`1枚 ${yen(ctx.price)}(事前カード決済のみ)`} />
          <Bf6Card>
            <select value={qty} onChange={(e) => setQty(Number(e.target.value))} className={inputCls}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}枚</option>
              ))}
            </select>
          </Bf6Card>
        </section>

        <div className="mt-6 rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
          <p className="text-xs font-bold tracking-widest text-neutral-400">合計金額</p>
          <p className="mt-1 text-5xl font-black text-white">{yen(total)}</p>
        </div>

        {error && <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm font-bold text-red-400">{error}</p>}

        <button
          onClick={() => {
            if (!buyerName.trim() || !email.trim() || !phone.trim()) { setError('お名前・メールアドレス・電話番号を入力してください'); return; }
            setError('');
            setStep('confirm');
            window.scrollTo({ top: 0 });
          }}
          className={`mt-5 w-full rounded-2xl py-4 text-lg font-black active:scale-[0.99] ${btnPrimaryCls}`}
        >
          入力内容を確認する
        </button>

        <p className="mt-5 text-center text-xs text-neutral-400">
          すでに視聴キーをお持ちの方は <Link href="/bf6/stream/watch" className="font-bold text-red-400 underline">視聴ページへ</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <Bf6Shell>{children}</Bf6Shell>;
}
