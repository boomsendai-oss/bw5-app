'use client';

// BW6 発表会の「受付を開ける／止める」と「支払いを開ける」。どれも2段階＋押す人の名前（confirm() のダイアログは使わない）。
// 「支払いを開ける」は pay_ok_at が空の時だけ出す。押したあとは時刻を出すだけで、戻すボタンは作らない（止めたい時は pay_open_at を先へ。K224）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { openEntryAction, openPayAction, suspendEntryAction } from './actions';

/** 'YYYY-MM-DD HH:MM'（JST）→「M月D日 H時」。形がちがえばそのまま */
function payOkLabel(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(v);
  if (!m) return v;
  return `${Number(m[2])}月${Number(m[3])}日 ${Number(m[4])}時`;
}

const BTN_MAIN = 'rounded-lg bg-brand-600 px-4 py-2 font-bold text-white disabled:opacity-50';
const BTN_SUB = 'rounded-lg border border-sand-300 bg-white px-4 py-2 text-navy-700 disabled:opacity-50';

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-4 w-4 accent-brand-600" />
      <span>{children}</span>
    </label>
  );
}

export default function GateButtons(props: { ev: string; suspended: boolean; payOkAt: string | null; bankEmpty: boolean }) {
  const { ev, suspended, payOkAt, bankEmpty } = props;
  return (
    <section className="space-y-4 rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">受付と支払いの鍵</h2>
      <EntryGate key={suspended ? 'sus' : 'open'} ev={ev} suspended={suspended} />
      <PayGateBox key={payOkAt ?? 'none'} ev={ev} payOkAt={payOkAt} bankEmpty={bankEmpty} />
    </section>
  );
}

function EntryGate({ ev, suspended }: { ev: string; suspended: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const label = suspended ? '受付を開ける' : '受付を止める';

  const go = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = suspended ? await openEntryAction(ev, name) : await suspendEntryAction(ev, name);
      if (!r.ok) { setError(r.error); return; }
      setError('');
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-sand-200 p-3">
      <h3 className="font-bold">受付</h3>
      {suspended ? (
        <p className="mt-1 text-sm">
          今は止めています。開けたあとは、<code className="rounded bg-sand-50 px-1">entry_open_at</code> の時刻で自動で開きます。
        </p>
      ) : (
        <p className="mt-1 text-sm">止めていません（受付の時刻のあいだは、フォームが開きます）。止めると、フォームは「ただいま受付を止めています」になります。</p>
      )}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`mt-2 ${BTN_MAIN}`}>{label}</button>
      ) : (
        <div className="mt-2 space-y-2 rounded-lg bg-sand-50 p-3">
          <p className="text-sm font-bold">本当に「{label}」を押しますか。</p>
          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={setName} />
            <button type="button" onClick={go} disabled={pending} className={BTN_MAIN}>はい、{label}</button>
            <button type="button" onClick={() => { setOpen(false); setError(''); }} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}

function PayGateBox({ ev, payOkAt, bankEmpty }: { ev: string; payOkAt: string | null; bankEmpty: boolean }) {
  const router = useRouter();
  const [replied, setReplied] = useState(false);
  const [smokeOk, setSmokeOk] = useState(false);
  const [cardOnlyOk, setCardOnlyOk] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [doneAt, setDoneAt] = useState<string | null>(payOkAt);
  const [pending, startTransition] = useTransition();
  const ready = replied && smokeOk && (!bankEmpty || cardOnlyOk);

  if (doneAt) {
    return (
      <div className="rounded-lg border border-sand-200 p-3">
        <h3 className="font-bold">支払い</h3>
        <p className="mt-1 text-sm">{payOkLabel(doneAt)}に開けました（{doneAt}）</p>
        <p className="mt-1 text-xs text-sand-800">止めたい時は、下の「「払う」を出す日時（pay_open_at）」を先へ動かしてください。</p>
      </div>
    );
  }

  const go = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await openPayAction(ev, { replied, smokeOk, cardOnlyOk: bankEmpty ? cardOnlyOk : undefined }, name);
      if (!r.ok) { setError(r.error); return; }
      setError('');
      setDoneAt(r.payOkAt);
      router.refresh();
    });
  };

  return (
    <div className="rounded-lg border border-sand-200 p-3">
      <h3 className="font-bold">支払い</h3>
      <p className="mt-1 text-sm">まだ開けていません。時刻（pay_open_at）が来ても、ここを押すまで「払う」は出ません。</p>
      {bankEmpty && (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          振込先（bank_text）が空です。このまま開けるとカードだけになります
        </p>
      )}
      <div className="mt-2 space-y-1">
        <Check checked={replied} onChange={setReplied}>TARO から『開けてよい』の返事をもらいましたか</Check>
        <Check checked={smokeOk} onChange={setSmokeOk}>本番の少額の試しは、通りましたか</Check>
        {bankEmpty && <Check checked={cardOnlyOk} onChange={setCardOnlyOk}>カードだけで開けてよい</Check>}
      </div>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} disabled={!ready} className={`mt-2 ${BTN_MAIN}`}>支払いを開ける</button>
      ) : (
        <div className="mt-2 space-y-2 rounded-lg bg-sand-50 p-3">
          <p className="text-sm font-bold">本当に「支払いを開ける」を押しますか。押したあとは戻せません。</p>
          <div className="flex flex-wrap items-center gap-2">
            <StaffNamePicker value={name} onChange={setName} />
            <button type="button" onClick={go} disabled={pending || !ready} className={BTN_MAIN}>はい、支払いを開ける</button>
            <button type="button" onClick={() => { setOpen(false); setError(''); }} disabled={pending} className={BTN_SUB}>やめる</button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
