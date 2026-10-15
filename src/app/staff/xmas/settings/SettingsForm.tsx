'use client';

import { useState, useTransition } from 'react';
import { entryUnitPrice, type PartySettings } from '@/lib/party';
import { saveXmasSettings } from '../actions';

const inputCls =
  'w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none';

export default function SettingsForm({ initial }: { initial: PartySettings }) {
  const [s, setS] = useState<PartySettings>(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof PartySettings>(k: K, v: PartySettings[K]) => setS((p) => ({ ...p, [k]: v }));
  const num = (k: 'presalePrice' | 'doorPrice' | 'performerFee' | 'teamCap' | 'venueFee') => (
    <input type="number" inputMode="numeric" min={0} className={inputCls} value={s[k]} onChange={(e) => set(k, Number(e.target.value))} />
  );
  const dt = (k: 'openAt' | 'ticketOpenAt' | 'ticketCardDeadline' | 'ticketCashDeadline' | 'entryDeadline' | 'audioDeadline') => (
    <input type="datetime-local" className={inputCls} value={s[k]} onChange={(e) => set(k, e.target.value)} />
  );

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveXmasSettings(s);
      setMsg(r.ok ? { ok: true, text: '保存しました' } : { ok: false, text: r.error });
    });
  }

  return (
    <div className="space-y-5">
      <Section title="受付の開始と停止">
        <Item label="チケット予約の受付開始" hint="空のままならエントリーと同時に開く。日本時間で入力">
          {dt('ticketOpenAt')}
        </Item>
        <Item label="出演エントリーの受付開始(先着)" hint="空のままなら未公開。日本時間で入力">
          {dt('openAt')}
        </Item>
        <label className="flex items-center gap-2 text-sm font-semibold text-red-700">
          <input type="checkbox" checked={s.suspended} onChange={(e) => set('suspended', e.target.checked)} className="h-4 w-4" />
          緊急停止(すべての受付を止める)
        </label>
      </Section>

      <Section title="締切(商品ごとに別)">
        <Item label="カード前売の締切">{dt('ticketCardDeadline')}</Item>
        <Item label="当日現金予約の締切">{dt('ticketCashDeadline')}</Item>
        <Item label="出演エントリーの締切">{dt('entryDeadline')}</Item>
        <Item label="音源の提出締切">{dt('audioDeadline')}</Item>
        <p className="text-xs text-neutral-500">締切の時刻の「分」までは受け付けます(20:00締切なら20:00:59まで)。</p>
      </Section>

      <Section title="料金・上限">
        <div className="grid grid-cols-2 gap-3">
          <Item label="前売(1人)">{num('presalePrice')}</Item>
          <Item label="当日券(1人)">{num('doorPrice')}</Item>
          <Item label="出演料(1人)">{num('performerFee')}</Item>
          <Item label="出演チームの上限">{num('teamCap')}</Item>
          <Item label="会場費(税込)">{num('venueFee')}</Item>
        </div>
        <p className="text-xs text-neutral-500">
          出演エントリーの請求 = 出演料 ¥{entryUnitPrice(s).toLocaleString()} × 人数(入場は出演者もチケット予約で別に払う)。すでに受け付けた申込の金額は変わりません。
        </p>
      </Section>

      <button
        type="button"
        onClick={save}
        disabled={pending}
        className="w-full rounded-lg bg-brand-600 py-3 font-bold text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {pending ? '保存中…' : '保存する'}
      </button>
      {msg && <p className={`text-sm font-semibold ${msg.ok ? 'text-brand-700' : 'text-red-600'}`}>{msg.text}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-sand-200 bg-white p-4">
      <h2 className="text-sm font-bold text-navy-800">{title}</h2>
      {children}
    </section>
  );
}

function Item({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-navy-800">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}
