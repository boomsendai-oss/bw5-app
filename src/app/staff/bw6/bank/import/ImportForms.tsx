'use client';

// BW6 発表会の「入金の取り込み」の入力（Task 29）：手で打つ欄・明細のファイル・待ちのメールを、今出す。
// どれも名前（StaffNamePicker）を選んでから押す。入力欄は文字色と下地色を両方決める（RECITAL_INPUT_CLS。CLAUDE.md 11）。
// 結果は数と日付だけを出す（名義・残高・金額を出さない）。
import { useState, useTransition } from 'react';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { fileImportAction, flushWaitingAction, manualEntryAction } from './actions';

type Result = { ok: true; message: string } | { ok: false; error: string };

const BTN_GO = 'rounded-md bg-brand-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40';

function Message({ r }: { r: Result | null }) {
  if (!r) return null;
  return r.ok
    ? <p className="rounded-md bg-brand-50 px-2 py-1 text-sm text-brand-700">{r.message}</p>
    : <p className="text-sm font-bold text-red-800">{r.error}</p>;
}

export default function ImportForms({ ev, canFlush }: { ev: string; canFlush: boolean }) {
  return (
    <>
      <ManualForm ev={ev} />
      <FileForm ev={ev} />
      <FlushButton ev={ev} canFlush={canFlush} />
    </>
  );
}

/** 手で打つ欄（日付・金額・残高・摘要の4つ。4つとも入れないと押せない） */
function ManualForm({ ev }: { ev: string }) {
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [balance, setBalance] = useState('');
  const [desc, setDesc] = useState('');
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const filled = date !== '' && amount.trim() !== '' && balance.trim() !== '' && desc.trim() !== '';

  const go = () => {
    if (!name) { setResult({ ok: false, error: '名前を選んでください' }); return; }
    startTransition(async () => {
      const r = await manualEntryAction({ ev, date, amount, balance, desc, staffName: name });
      setResult(r);
      if (r.ok) { setDate(''); setAmount(''); setBalance(''); setDesc(''); }
    });
  };

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">手で打つ（振込の入金を1行）</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="text-xs font-bold text-sand-800">日付</span>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={RECITAL_INPUT_CLS} />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-bold text-sand-800">金額（円）</span>
          <input type="text" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="26500" className={RECITAL_INPUT_CLS} />
        </label>
        <label className="block text-sm">
          <span className="text-xs font-bold text-sand-800">残高（円）</span>
          <input type="text" inputMode="numeric" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="153000" className={RECITAL_INPUT_CLS} />
        </label>
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-xs font-bold text-sand-800">摘要</span>
        <input type="text" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={100} className={RECITAL_INPUT_CLS} />
        <span className="mt-1 block text-xs text-sand-800">通帳やアプリの『振込』のあとの文字を、そのまま（例：4827 ヤマダ ハナコ）</span>
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={setName} />
        <button type="button" disabled={pending || !filled} onClick={go} className={BTN_GO}>
          {pending ? '入れています…' : '1行を入れる'}
        </button>
      </div>
      <div className="mt-2"><Message r={result} /></div>
    </section>
  );
}

/** 明細のファイル（GMOあおぞらの入出金明細の CSV） */
function FileForm({ ev }: { ev: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [pending, startTransition] = useTransition();

  const go = () => {
    if (!name) { setResult({ ok: false, error: '名前を選んでください' }); return; }
    if (!file) { setResult({ ok: false, error: 'ファイルを選んでください' }); return; }
    const fd = new FormData();
    fd.set('ev', ev);
    fd.set('staffName', name);
    fd.set('file', file);
    startTransition(async () => {
      const r = await fileImportAction(fd);
      setResult(r);
      if (r.ok) { setFile(null); setInputKey((k) => k + 1); }
    });
  };

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">明細のファイルを入れる</h2>
      <p className="mt-1 text-xs text-sand-800">GMOあおぞらネット銀行の「入出金明細」から出した CSV のファイル。行が多い時は、月ごとに分けて入れてください。</p>
      <input
        key={inputKey}
        type="file"
        accept=".csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="mt-2 block w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-base text-navy-900"
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={setName} />
        <button type="button" disabled={pending || !file} onClick={go} className={BTN_GO}>
          {pending ? '入れています…' : 'ファイルを入れる'}
        </button>
      </div>
      <div className="mt-2"><Message r={result} /></div>
    </section>
  );
}

/** 待ちのメールを、今出す（JST の 8:00〜21:00 だけ押せる。サーバでももう一度確かめる） */
function FlushButton({ ev, canFlush }: { ev: string; canFlush: boolean }) {
  const [name, setName] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  const go = () => {
    if (!name) { setResult({ ok: false, error: '名前を選んでください' }); return; }
    startTransition(async () => setResult(await flushWaitingAction({ ev, staffName: name })));
  };
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">待ちのメールを、今出す</h2>
      <p className="mt-1 text-xs text-sand-800">夜に当たった入金の「ご入金を確認しました」のメールです。出せるのは朝8時〜夜9時です。</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StaffNamePicker value={name} onChange={setName} />
        <button type="button" disabled={pending || !canFlush} onClick={go} className={BTN_GO}>
          {pending ? '出しています…' : '待ちのメールを、今出す'}
        </button>
        {!canFlush && <span className="text-xs text-sand-800">今の時間は出せません</span>}
      </div>
      <div className="mt-2"><Message r={result} /></div>
    </section>
  );
}
