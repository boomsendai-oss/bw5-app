'use client';

// BW6 発表会のマイページの「払う」（Task 21。04 4-2・5-6、決まりの紙 2-20 の表）。
// payState が show の時だけ、MoneyBox の children に入る。ほかの状態の文は 14 の payAreaText（ここでは書かない）。
// 決済の画面から戻った時の受付の文は page.tsx が出す（残りが無い・確認中の時だけ）。
// 選べるのはカードと銀行振込だけ（現金は出さない。決まり 16）。銀行振込を選ぶと「お振込みのご案内」（BankGuide・Task 23）。
// pay_method=bank の世帯は、開いた時から BankGuide を出す。bank_text が空（bank=null）の間は「銀行振込は、準備中です」で押せない（K210）。
// 金額は家庭から送らない（サーバでその時の今の残りから出す）。受け取るのは鍵・残り・振込の印の金額・ご案内の文・進みの文だけ（R-66）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { yenJa } from '@/lib/recitalPublic';
import { chooseBankAction, payByCardAction } from './actions';
import { BankGuide, BankToldForm, TOLD_DONE_LINES, type BankGuideData } from './BankGuide';

type Step = 'idle' | 'choose' | 'ask_bank' | 'told_open' | 'bank' | 'told_form';

const bigBtnCls = 'block w-full rounded-xl bg-navy-700 px-4 py-3 text-center text-lg font-bold text-white disabled:opacity-40';
const subBtnCls = 'block w-full rounded-xl border-2 border-navy-700 bg-white px-4 py-3 text-center text-base font-bold text-navy-700 disabled:opacity-40';
const smallLinkCls = 'block w-full bg-transparent px-2 py-1 text-center text-sm text-navy-700 underline disabled:opacity-40';
const msgCls = 'rounded-xl border border-sand-300 bg-sand-100 px-4 py-3 text-base font-bold leading-relaxed text-navy-700';

export function PaySection(props: {
  token: string; remaining: number; toldAmount: number | null;
  /** 「お振込みのご案内」の中身。bank_text が空なら null（銀行振込は選べない） */
  bank: BankGuideData | null;
  payMethod: string | null;
  /** 振込の進みの文（2-20「家庭の画面の状態」。サーバで作る） */
  progress: string[];
  today: string;
}) {
  const { token, remaining, toldAmount, bank, payMethod, progress, today } = props;
  const router = useRouter();
  const [step, setStep] = useState<Step>(payMethod === 'bank' && bank ? 'bank' : 'idle');
  const [openForm, setOpenForm] = useState(false);
  const [toldDone, setToldDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [goUrl, setGoUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const chooseBank = () => {
    setError(null);
    startTransition(async () => {
      let r: Awaited<ReturnType<typeof chooseBankAction>>;
      try {
        r = await chooseBankAction(token);
      } catch {
        setError('もう一度押してください');
        return;
      }
      if ('error' in r) { setError(r.error); return; }
      if ('ok' in r) { setStep('bank'); router.refresh(); return; }
      router.refresh();   // 選べない状態に変わった（準備中・残り0）。今の画面を出し直す
    });
  };

  const payCard = (opts: { confirmNotBank?: boolean; confirmTold?: boolean }) => {
    setError(null);
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
  // もどる先：振込を選んだ世帯はご案内、ほかは「払う」
  const home: Step = payMethod === 'bank' && bank ? 'bank' : 'idle';

  return (
    <div className="space-y-3">
      {progress.length > 0 && (
        <div className={msgCls}>
          {progress.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}

      {step === 'bank' && bank && (
        <BankGuide
          token={token}
          guide={bank}
          today={today}
          remaining={remaining}
          toldAmount={toldAmount}
          openForm={openForm}
          onOpenForm={setOpenForm}
          onCard={() => payCard({})}
          pending={pending}
        />
      )}

      {(step === 'idle' || (step === 'bank' && !bank)) && (
        <button type="button" className={bigBtnCls} onClick={() => setStep('choose')}>
          払う
        </button>
      )}

      {step === 'choose' && (
        <div className="space-y-2">
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => payCard({})}>
            カードで払う
          </button>
          <button type="button" className={subBtnCls} disabled={pending || !bank} onClick={chooseBank}>
            銀行振込
          </button>
          {!bank && <p className="text-center text-sm">銀行振込は、準備中です</p>}
        </div>
      )}

      {step === 'ask_bank' && (
        <div className="space-y-2">
          <p className={msgCls}>まだ振り込んでいませんか</p>
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => payCard({ confirmNotBank: true })}>
            まだ振り込んでいません
          </button>
          {/* 「もう振り込みました」→「振り込みました」の3つの欄（ご案内が出せる時はご案内の下の欄を開く） */}
          <button
            type="button"
            className={subBtnCls}
            disabled={pending}
            onClick={() => {
              setToldDone(false);
              if (bank) { setOpenForm(true); setStep('bank'); } else setStep('told_form');
            }}
          >
            もう振り込みました
          </button>
          <button type="button" className={smallLinkCls} disabled={pending} onClick={() => setStep(home)}>
            もどる
          </button>
        </div>
      )}

      {step === 'told_form' && !toldDone && (
        <BankToldForm token={token} today={today} initialAmount={toldAmount ?? remaining} onDone={() => setToldDone(true)} onCancel={() => setStep(home)} />
      )}
      {step === 'told_form' && toldDone && (
        <div className={msgCls}>
          {TOLD_DONE_LINES.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      )}

      {step === 'told_open' && toldAmount != null && !toldMore && (
        <div className="space-y-2">
          <p className={msgCls}>確認中です。カードで払うと二重になります</p>
          <button type="button" className={bigBtnCls} disabled={pending} onClick={() => setStep(home)}>
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
          <button type="button" className={subBtnCls} disabled={pending} onClick={() => setStep(home)}>
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
