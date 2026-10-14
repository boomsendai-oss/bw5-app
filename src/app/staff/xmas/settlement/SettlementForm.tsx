'use client';

// 当日精算の入力。期待額との差と会場費相殺の結果は calcSettlement(純関数)で出す。
import { useState, useTransition } from 'react';
import { calcSettlement, yen } from '@/lib/party';
import { saveXmasSettlement } from '../actions';

const inputCls =
  'w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none';

export default function SettlementForm(p: { expectedCash: number; doorPrice: number; venueFee: number }) {
  const [walkin, setWalkin] = useState(0);
  const [actual, setActual] = useState(0);
  const [staff, setStaff] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const r = calcSettlement({ expectedCash: p.expectedCash, walkinCount: walkin, actualCash: actual, doorPrice: p.doorPrice, venueFee: p.venueFee });

  function save() {
    setMsg(null);
    start(async () => {
      const res = await saveXmasSettlement({ walkinCount: walkin, actualCash: actual, staffName: staff });
      setMsg(res.ok ? { ok: true, text: '精算を記録しました(やり直すと上書きされます)' } : { ok: false, text: res.error });
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-sand-200 bg-white p-4">
      <h2 className="text-sm font-bold text-navy-800">当日の現金精算</h2>
      <p className="text-sm text-navy-800">予約分(当日現金)でキャッシャーに入るはずの額: <b>{yen(p.expectedCash)}</b></p>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-navy-800">当日券の人数(キャッシャーが数えた)</span>
          <input type="number" min={0} inputMode="numeric" className={inputCls} value={walkin} onChange={(e) => setWalkin(Number(e.target.value))} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-navy-800">キャッシャーが受け取った現金の実額(ドリンク代は除く)</span>
          <input type="number" min={0} inputMode="numeric" className={inputCls} value={actual} onChange={(e) => setActual(Number(e.target.value))} />
        </label>
      </div>
      <dl className="rounded-lg bg-sand-50 p-3 text-sm text-navy-800">
        <div className="flex justify-between"><dt>当日券の見込み({walkin}人 × {yen(p.doorPrice)})</dt><dd>{yen(r.walkinExpected)}</dd></div>
        <div className="flex justify-between"><dt>入るはずの合計</dt><dd>{yen(r.expectedTotal)}</dd></div>
        <div className={`flex justify-between font-bold ${r.diff === 0 ? 'text-brand-700' : 'text-red-600'}`}>
          <dt>実額との差</dt>
          <dd>{r.diff === 0 ? 'ぴったり' : `${r.diff > 0 ? '+' : ''}${yen(r.diff)}`}</dd>
        </div>
        <div className="mt-2 flex justify-between border-t border-sand-200 pt-2 text-base font-bold">
          <dt>会場費 {yen(p.venueFee)} と相殺</dt>
          <dd>{r.netToBoom >= 0 ? `BOOMが受け取る ${yen(r.netToBoom)}` : `BOOMが払う ${yen(-r.netToBoom)}`}</dd>
        </div>
      </dl>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-navy-800">入力した人の名前(必須)</span>
        <input className={inputCls} value={staff} onChange={(e) => setStaff(e.target.value)} placeholder="例: TARO" />
      </label>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="w-full rounded-lg bg-brand-600 py-3 font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? '記録中…' : '精算を記録する'}
      </button>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? 'text-brand-700' : 'text-red-600'}`}>{msg.text}</p>}
    </section>
  );
}
