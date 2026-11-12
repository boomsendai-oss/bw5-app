'use client';

// BW6 発表会のスタッフの世帯の画面の「マイページのURLを写す」「控えを送り直す」「メールアドレスを直す」「公式LINEのひな形」。
// マイページの URL は押した時だけ Server Action でもらう（鍵を初めの HTML に入れない。location.origin はスタッフの bw5-app なので使わない）。
// 2段階＋名前を選ぶ（confirm() のダイアログは使わない）。入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { RECITAL_PUBLIC_ORIGIN } from '@/lib/recital';
import { RECITAL_LINE_REPLIES, fillLineReply } from '@/lib/recitalLineReplies';
import { changeEmailAction, myPageUrlAction, resendReceiptAction } from './actions';

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';

const RESEND_STATUS_LABEL: Record<string, string> = {
  sent: '送りました',
  failed: '送れませんでした（失敗）。アドレスを確かめてください',
  waiting: '待ちになりました（あとで送られます）',
  duplicate: 'もう送ってあります',
};

/** 写せた時は true。写せない時は false（呼ぶ側が欄に出して長押しで写してもらう） */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** 写せなかった時に出す、選んで写すための欄 */
function ManualCopy({ text }: { text: string }) {
  return (
    <textarea
      readOnly
      value={text}
      rows={3}
      onFocus={(e) => e.currentTarget.select()}
      className={`${RECITAL_INPUT_CLS} mt-2 text-sm`}
      aria-label="写す文"
    />
  );
}

/** active でない（まとめた）世帯では、控えの送り直しとメールアドレスの直しを出さない（サーバでも拒む） */
export default function CopyButtons(props: { householdId: number; refCode: string; remaining: number; payDue: string; active: boolean }) {
  return (
    <div className="space-y-3">
      <MyUrlButton householdId={props.householdId} />
      {props.active && <ResendReceiptButton householdId={props.householdId} />}
      {props.active && <ChangeEmailBox householdId={props.householdId} />}
      <LineReplies refCode={props.refCode} remaining={props.remaining} payDue={props.payDue} />
    </div>
  );
}

function MyUrlButton({ householdId }: { householdId: number }) {
  const [msg, setMsg] = useState('');
  const [manual, setManual] = useState('');
  const [pending, startTransition] = useTransition();
  const go = () => {
    setMsg('');
    setManual('');
    startTransition(async () => {
      try {
        const { url } = await myPageUrlAction(householdId);
        if (await copyText(url)) setMsg('写しました');
        else { setMsg('写せませんでした。下の欄を長押しして写してください'); setManual(url); }
      } catch {
        setMsg('URLをもらえませんでした。画面を開き直してください');
      }
    });
  };
  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>マイページのURLを写す</button>
        {msg && <span className="text-sm font-bold text-navy-700">{msg}</span>}
      </div>
      <p className="mt-1 text-xs text-sand-700">LINE の相手が、この世帯の人だと分かる時だけ貼る</p>
      {manual && <ManualCopy text={manual} />}
    </div>
  );
}

function ResendReceiptButton({ householdId }: { householdId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();
  const go = () => {
    startTransition(async () => {
      const r = await resendReceiptAction(householdId);
      setMsg(r.ok ? (RESEND_STATUS_LABEL[r.status] ?? r.status) : r.error);
      setOpen(false);
      router.refresh();
    });
  };
  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className={BTN_SUB}>控えを送り直す</button>
      ) : (
        <div className="space-y-2 rounded-lg bg-sand-50 p-3">
          <p className="text-sm font-bold text-navy-700">申込のメールアドレスへ、受付の控えをもう一度送りますか。</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、送る</button>
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
        </div>
      )}
      {msg && <p className="mt-2 text-sm font-bold text-navy-700">{msg}</p>}
    </div>
  );
}

function ChangeEmailBox({ householdId }: { householdId: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, startTransition] = useTransition();
  const close = () => { setOpen(false); setConfirming(false); setEmail(''); setError(''); };
  const toConfirm = () => {
    if (email.trim() === '') { setError('新しいアドレスを入れてください'); return; }
    if (!name) { setError('名前を選んでください'); return; }
    setError('');
    setConfirming(true);
  };
  const go = () => {
    startTransition(async () => {
      const r = await changeEmailAction(householdId, email, name);
      if (!r.ok) { setError(r.error); setConfirming(false); return; }
      close();
      setMsg(r.mailSent
        ? '直しました。新しいアドレスへマイページのURLを送りました'
        : `直しました。新しいアドレスへのURLのメール：${r.mailStatus ?? '記録が見つかりません'}`);
      router.refresh();
    });
  };
  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3">
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setMsg(''); }} className={BTN_SUB}>メールアドレスを直す</button>
      ) : (
        <div className="space-y-2">
          <label className="block text-sm text-navy-700">
            新しいメールアドレス
            <input
              type="email"
              inputMode="email"
              autoComplete="off"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setConfirming(false); }}
              className={`${RECITAL_INPUT_CLS} mt-1`}
            />
          </label>
          <p className="text-sm font-bold text-red-800">古いURLは使えなくなります（新しいアドレスへ、新しいURLを送ります）。</p>
          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={setName} />
            {!confirming ? (
              <button type="button" onClick={toConfirm} className={BTN_MAIN}>直す</button>
            ) : (
              <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、このアドレスに直す</button>
            )}
            <button type="button" onClick={close} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
      {msg && <p className="mt-2 text-sm font-bold text-navy-700">{msg}</p>}
    </div>
  );
}

function LineReplies({ refCode, remaining, payDue }: { refCode: string; remaining: number; payDue: string }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [manual, setManual] = useState(false);
  const d = { refCode, remaining, payDue, resendUrl: `${RECITAL_PUBLIC_ORIGIN}/bw6/resend` };
  const cur = RECITAL_LINE_REPLIES.find((r) => r.key === key) ?? null;
  const text = cur ? fillLineReply(cur.text, d) : '';
  const copy = async () => {
    if (await copyText(text)) { setMsg('写しました'); setManual(false); }
    else { setMsg('写せませんでした。下の欄を長押しして写してください'); setManual(true); }
  };
  return (
    <div className="rounded-lg border border-sand-200 bg-white p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className={BTN_SUB} aria-expanded={open}>
        公式LINEのひな形{open ? 'を閉じる' : ''}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <ul className="divide-y divide-sand-100">
            {RECITAL_LINE_REPLIES.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => { setKey(r.key); setMsg(''); setManual(false); }}
                  className={`w-full py-2 text-left text-sm ${r.key === key ? 'font-bold text-brand-700' : 'text-navy-700'}`}
                >
                  {r.key === 'tsunagi' ? 'つなぎ' : r.key}. {r.title}
                </button>
              </li>
            ))}
          </ul>
          {cur && (
            <div className="rounded-lg bg-sand-50 p-3">
              <p className="whitespace-pre-wrap break-words text-sm text-navy-900">{text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={copy} className={BTN_MAIN}>写す</button>
                {msg && <span className="text-sm font-bold text-navy-700">{msg}</span>}
              </div>
              {manual && <ManualCopy text={text} />}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
