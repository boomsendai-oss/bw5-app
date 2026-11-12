'use client';

// BW6 発表会のマイページの「払う」（Task 21。04 4-2・5-6、決まりの紙 2-20 の表）。
// payState が show の時だけ、MoneyBox の children に入る。ほかの状態の文は 14 の payAreaText（ここでは書かない）。
// 選べるのはカードと銀行振込だけ（現金は出さない。決まり 16）。銀行振込の中身は Task 23（この段は「準備中」で押せない）。
// 金額は家庭から送らない（サーバでその時の今の残りから出す）。受け取るのは鍵・残り・振込の印の金額だけ（R-66）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { yenJa } from '@/lib/recitalPublic';
import { payByCardAction } from './actions';

type Step = 'idle' | 'choose' | 'ask_bank' | 'told_open';

const bigBtnCls = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center text-lg font-bold text-white disabled:opacity-40';
const subBtnCls = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center text-base font-bold text-navy-700 disabled:opacity-40';
const smallLinkCls = 'block w-full bg-transparent px-2 py-1 text-center text-sm text-navy-700 underline disabled:opacity-40';
const msgCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-base font-bold leading-relaxed text-navy-700';

export function PaySection({ token, paidReturn, remaining, toldAmount }: { token: string; paidReturn: boolean; remaining: number; toldAmount: number | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState<string | null>(null);
  const [bankNote, setBankNote] = useState(false);
  const [goUrl, setGoUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (paidReturn) {
    return <p className={msgCls}>お支払いを受け付けました。完了のメールが届きます。この画面は、閉じて大丈夫です。もう一度払う必要は、ありません。</p>;
  }

  const payCard = (opts: { confirmNotBank?: boolean; confirmTold?: boolean }) => {
    setError(null);
    setBankNote(false);
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof payByCardAction>>;
      try {
        r = await payByCardAction(token, opts);
      } catch {
        setError('もう一度押してください');
        return;
      }
      if ('url' in r) {
        setGoUrl(r.url);
        window.location.assign(r.url);
        return;
      }
      if ('error' in r) {
        setError(r.error);
        return;
      }
      if (r.blocked === 'ask_bank') setStep('ask_bank');
      else if (r.blocked === 'told_open') {
        if (toldAmount == null) router.refresh();   // 開いたあとに印が付いた。印の金額を読み直す
        setStep('told_open');
      }
      else router.refresh();   // 払えない状態に変わった（準備中・残り0・お預かり）。今の画面を出し直す
    });
  };

  const toldMore = toldAmount != null && remaining > toldAmount;

  return (
    <div className="space-y-3">
      {step === 'idle' && (
        <button type="button" className={bigBtnCls} onClick={() => setStep('choose')}>
          払う
        </button>
      )}

      {step === 'choose' && (
        <div className="space-y-2">
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => payCard({})}>
            カードで払う
          </button>
          <button type="button" className={subBtnCls} disabled>
            銀行振込
          </button>
          <p className="text-center text-sm">銀行振込は、準備中です</p>
        </div>
      )}

      {step === 'ask_bank' && (
        <div className="space-y-2">
          <p className={msgCls}>まだ振り込んでいませんか</p>
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => payCard({ confirmNotBank: true })}>
            まだ振り込んでいません
          </button>
          {/* 「振り込みました」の3つの欄は Task 23 が入れる。この段は銀行振込と同じく準備中 */}
          <button type="button" className={subBtnCls} disabled={pending} onClick={() => setBankNote(true)}>
            もう振り込みました
          </button>
          {bankNote && <p className="text-center text-sm">銀行振込は、準備中です</p>}
        </div>
      )}

      {step === 'told_open' && toldAmount != null && !toldMore && (
        <div className="space-y-2">
          <p className={msgCls}>確認中です。カードで払うと二重になります</p>
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => setStep('idle')}>
            もどる
          </button>
          <button type="button" className={smallLinkCls} disabled={pending} onClick={() => payCard({ confirmNotBank: true, confirmTold: true })}>
            それでもカードで払う
          </button>
        </div>
      )}

      {step === 'told_open' && toldAmount != null && toldMore && (
        <div className="space-y-2">
          <p className={msgCls}>
            お振込みの {yenJa(toldAmount)}は、確認中です。のこりの {yenJa(remaining - toldAmount)}だけを、カードで払います
          </p>
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => payCard({ confirmNotBank: true, confirmTold: true })}>
            カードで払う
          </button>
          <button type="button" className={subBtnCls} disabled={pending} onClick={() => setStep('idle')}>
            もどる
          </button>
        </div>
      )}

      {goUrl && (
        <a href={goUrl} rel="noreferrer" className={subBtnCls}>
          決済の画面を開く
        </a>
      )}
      {error && <p className={msgCls}>{error}</p>}
      <p className="text-center text-sm">うまく進まないときは、ブラウザで開いてください</p>
    </div>
  );
}
