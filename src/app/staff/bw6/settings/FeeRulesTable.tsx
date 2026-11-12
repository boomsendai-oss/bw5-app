'use client';

// BW6 発表会の料金の規則と検算。検算（feeCheck）はページが計算して渡し、ここではいつも出す（合う・合わない）。
// 受付を止めている間（suspended）だけ、行の金額・数・名前・仮を直せる。開けたかどうかの最後の判定は saveFeeRule（opened）。
// 入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import type { FeeRule } from '@/lib/recitalFee';
import { saveFeeRuleAction } from './actions';

type Rule = FeeRule & { id: number };

const ROLE_LABEL: Record<string, string> = { first: '1人目', family: '家族2人目から' };
const INPUT_CLS = 'w-full rounded-md border border-sand-300 bg-white px-2 py-1 text-base text-navy-900 placeholder:text-[#7a7a86]';
const yen = (n: number) => `${n.toLocaleString('ja-JP')}円`;

function nthText(r: Rule): string {
  if (r.nth_to === null) return `${r.nth_from}作品目から`;
  if (r.nth_to === r.nth_from) return `${r.nth_from}作品目`;
  return `${r.nth_from}〜${r.nth_to}作品目`;
}

/** 空・整数でない物は NaN（サーバで弾く） */
function toInt(s: string): number {
  const t = s.trim();
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

export default function FeeRulesTable(props: {
  ev: string;
  rules: Rule[];
  editable: boolean;
  check: { ok: boolean; first: number[]; family: number; tentative: boolean };
  expectFirst: number[];
  expectFamily: number;
}) {
  const { ev, rules, editable, check, expectFirst, expectFamily } = props;
  const [name, setName] = useState('');

  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">料金の規則</h2>
      {editable ? (
        <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span>受付を開ける前なので、金額・数・名前・仮を直せます。直す人：</span>
          <StaffNamePicker value={name} onChange={setName} />
        </div>
      ) : (
        <p className="mt-1 text-sm text-sand-800">受付を開けたあとは、料金の規則は変えません（見るだけ）。</p>
      )}

      {rules.length === 0 ? (
        <p className="mt-3 text-sm text-red-700">規則の行がありません。台帳SQLの種が入っているか確かめてください。</p>
      ) : (
        <ul className="mt-3 divide-y divide-sand-100">
          {rules.map((r) => (
            <RuleRow key={r.id} ev={ev} rule={r} editable={editable} name={name} />
          ))}
        </ul>
      )}

      {/* 検算（いつも出す） */}
      <div className={`mt-4 rounded-lg border p-3 ${check.ok ? 'border-brand-200 bg-brand-50' : 'border-red-300 bg-red-50'}`}>
        <h3 className="font-bold">
          検算：{check.ok ? <span className="text-brand-800">合っています</span> : <span className="text-red-700">合いません</span>}
        </h3>
        {check.tentative && <p className="mt-1 text-sm font-bold text-red-700">仮の金額の行があります。</p>}
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[18rem] text-left text-sm">
            <thead className="text-xs text-sand-800">
              <tr>
                <th className="py-1 pr-2 font-normal">場合</th>
                <th className="py-1 pr-2 font-normal">規則から出した額</th>
                <th className="py-1 font-normal">早見表</th>
              </tr>
            </thead>
            <tbody>
              {check.first.map((v, i) => {
                const want = expectFirst[i];
                const same = v === want;
                return (
                  <tr key={i} className={same ? '' : 'font-bold text-red-700'}>
                    <td className="py-1 pr-2">1人目・{i + 1}作品</td>
                    <td className="py-1 pr-2">{yen(v)}</td>
                    <td className="py-1">{want === undefined ? '—' : yen(want)}</td>
                  </tr>
                );
              })}
              <tr className={check.family === expectFamily ? '' : 'font-bold text-red-700'}>
                <td className="py-1 pr-2">家族2人目・1作品</td>
                <td className="py-1 pr-2">{yen(check.family)}</td>
                <td className="py-1">{yen(expectFamily)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-sand-800">早見表は、下の設定の「1人目の早見表」「家族2人目の1作品」です。</p>
      </div>
    </section>
  );
}

function RuleRow({ ev, rule, editable, name }: { ev: string; rule: Rule; editable: boolean; name: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState(String(rule.unit_amount));
  const [qty, setQty] = useState(String(rule.qty));
  const [label, setLabel] = useState(rule.label);
  const [tentative, setTentative] = useState(rule.is_tentative === 1);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = amount !== String(rule.unit_amount) || qty !== String(rule.qty) || label !== rule.label || tentative !== (rule.is_tentative === 1);

  const head = (
    <span className="text-sm font-bold">
      {ROLE_LABEL[rule.payer_role] ?? rule.payer_role}・{nthText(rule)}
      <span className="ml-1 text-xs font-normal text-sand-800">（{rule.item_code}）</span>
    </span>
  );

  if (!editable) {
    return (
      <li className="flex flex-wrap items-baseline justify-between gap-2 py-2">
        <div className="min-w-0">
          {head}
          <p className="break-words text-sm">{rule.label}</p>
        </div>
        <p className="text-sm">
          {yen(rule.unit_amount)} × {rule.qty}
          {rule.is_tentative === 1 && <span className="ml-2 rounded bg-red-100 px-1 text-xs font-bold text-red-700">仮</span>}
        </p>
      </li>
    );
  }

  const save = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await saveFeeRuleAction(ev, { id: rule.id, unit_amount: toInt(amount), qty: toInt(qty), label, is_tentative: tentative ? 1 : 0 }, name);
      if (!r.ok) { setError(r.error); setSaved(false); return; }
      setError('');
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <li className="space-y-2 py-3">
      {head}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[8rem_5rem_1fr_auto_auto] sm:items-end">
        <label className="block text-xs">
          金額（円）
          <input inputMode="numeric" value={amount} onChange={(e) => { setAmount(e.target.value); setSaved(false); }} className={INPUT_CLS} />
        </label>
        <label className="block text-xs">
          数
          <input inputMode="numeric" value={qty} onChange={(e) => { setQty(e.target.value); setSaved(false); }} className={INPUT_CLS} />
        </label>
        <label className="col-span-2 block text-xs sm:col-span-1">
          見せる名前
          <input value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} className={INPUT_CLS} />
        </label>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={tentative} onChange={(e) => { setTentative(e.target.checked); setSaved(false); }} className="h-4 w-4 accent-brand-600" />
          仮
        </label>
        <button type="button" onClick={save} disabled={pending || !changed} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
          保存
        </button>
      </div>
      {error && <p className="text-sm font-bold text-red-700">{error}</p>}
      {saved && !error && <p className="text-sm text-brand-800">保存しました。</p>}
    </li>
  );
}
