'use client';

// BW6 発表会の設定の鍵（RECITAL_SETTING_KEYS_SHOWN）を、まとまりごとに出して1つの鍵ずつ保存する。
// 見出しの言葉は、設計書 03 3-4 の設定の表の「中身」を短くした物（この下の表が正本）。
// pay_ok_at・bank_audit_done_at・suspended・stripe_mode は値を見せるだけ（直す欄を出さない。K224）。
// 入力欄は文字色と下地色を両方決める（CLAUDE.md 11）。
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import StaffNamePicker from '@/components/recital/StaffNamePicker';
import { RECITAL_INPUT_CLS } from '@/components/recital/inputCls';
import { RECITAL_SETTING_KEYS_SHOWN } from '@/lib/recital';
import { saveSettingAction } from './actions';

type Kind = 'datetime' | 'date' | 'int' | 'list' | 'text' | 'longtext' | 'bool';
type Field = { key: string; label: string; kind: Kind; note?: string };

const HINT: Record<Kind, string> = {
  datetime: '「2026-12-15 12:00」の形',
  date: '「2027-02-10」の形',
  int: '半角の整数',
  list: 'カンマで区切る',
  text: '',
  longtext: '',
  bool: '0（しない）か 1（する）',
};

const SECRET_NOTE = '作る人が入れる。台帳SQL・リポジトリには書かない';

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: '日付と締切',
    fields: [
      { key: 'entry_open_at', label: '受付を開ける日時', kind: 'datetime' },
      { key: 'entry_close_at', label: '申込の締切', kind: 'datetime' },
      { key: 'change_close_at', label: '家庭がマイページで足す・やめるをできる最後', kind: 'datetime' },
      { key: 'pay_open_at', label: '「払う」を出す日時（支払いを開けたあとに止めたい時は、先へ動かす）', kind: 'datetime' },
      { key: 'pay_due', label: 'お支払いの期限', kind: 'date' },
      { key: 'roster_fix_on', label: '名簿を固める日（空でよい）', kind: 'date' },
      { key: 'tshirt_order_on', label: 'Tシャツの発注日（空でよい）', kind: 'date' },
      { key: 'tshirt_close_at', label: 'Tシャツのサイズを決める最後', kind: 'datetime' },
      { key: 'name_fix_close_at', label: 'パンフに載せる名前を直せる最後（空でよい）', kind: 'datetime' },
    ],
  },
  {
    title: '人数',
    fields: [
      { key: 'min_self_apply_age', label: 'これより下の出演者は「連絡する人と同じ」を選べない（歳）', kind: 'int' },
      { key: 'max_works_per_person', label: '1人が出られる作品の数の上限', kind: 'int' },
      { key: 'fee_check_first', label: '1人目の早見表（検算用・1〜5作品）', kind: 'list' },
      { key: 'fee_check_family', label: '家族2人目の1作品（検算用）', kind: 'int' },
      { key: 'goal_people', label: '目標の人数', kind: 'int' },
      { key: 'breakeven_people', label: '損をしない人数', kind: 'int' },
      { key: 'cap_people', label: '上限の人数', kind: 'int' },
      { key: 'tshirt_sizes', label: 'Tシャツのサイズの一覧', kind: 'list' },
    ],
  },
  {
    title: '文',
    fields: [
      { key: 'consent_items', label: '同意の文（12/8 に固める）', kind: 'longtext' },
      { key: 'privacy_text', label: '使い道の知らせ（画面6）', kind: 'longtext' },
      { key: 'extra_costs_text', label: '「このほかにかかるもの」の文', kind: 'longtext' },
      { key: 'schedule_text', label: 'リハ・撮影の日程の文', kind: 'longtext' },
      { key: 'line_url', label: '公式LINEのURL（「こまったら」に出す。https:// だけ）', kind: 'text' },
      { key: 'tshirt_give_to', label: '出る人のほかに、Tシャツを渡す人', kind: 'longtext' },
    ],
  },
  {
    title: '振込',
    fields: [
      { key: 'bank_text', label: '振込先の文', kind: 'longtext', note: SECRET_NOTE },
      { key: 'ref_skip', label: '家庭に出さない整理番号（4けた）に足す分', kind: 'list', note: SECRET_NOTE },
      { key: 'pay_remind_stop_hours', label: '「取り込みが古い朝」を決める時間（時間）', kind: 'int' },
      { key: 'bank_ask_at', label: 'TARO への声かけの時刻', kind: 'list' },
      { key: 'bank_rest_from', label: '声かけを休む間の始め', kind: 'date' },
      { key: 'bank_rest_to', label: '声かけを休む間の終わり', kind: 'date' },
      { key: 'bank_audit_on', label: '総点検の日', kind: 'date' },
      { key: 'bank_close_on', label: '振込先を開けておく終わりの日', kind: 'date' },
    ],
  },
  {
    title: 'メール',
    fields: [
      { key: 'mail_bcc_staff', label: 'スタッフ宛の写しを付けるか', kind: 'bool' },
      { key: 'test_mail_to', label: '試しの発表会のメールをすりかえて送る先（空でよい）', kind: 'text' },
    ],
  },
];

// 値を見せるだけの鍵（直す欄を出さない）
const READ_ONLY: { key: string; label: string }[] = [
  { key: 'pay_ok_at', label: '支払いを開けた日時（「支払いを開ける」ボタンだけが入れる）' },
  { key: 'bank_audit_done_at', label: '総点検を済みにした日時（入金の取り込みの画面で入る）' },
  { key: 'suspended', label: '受付を止めている（1）か（「受付を開ける／止める」ボタンで変える）' },
  { key: 'stripe_mode', label: 'Stripe の鍵（test／live。種でだけ入れる）' },
];

// 表に書き忘れた鍵も消えないように、最後の「そのほか」に出す（見出しは鍵の名前のまま）
const LISTED = new Set(GROUPS.flatMap((g) => g.fields.map((f) => f.key)));
const LEFTOVER: Field[] = RECITAL_SETTING_KEYS_SHOWN.filter((k) => !LISTED.has(k)).map((k) => ({ key: k, label: k, kind: 'text' }));
const ALL_GROUPS = LEFTOVER.length > 0 ? [...GROUPS, { title: 'そのほか', fields: LEFTOVER }] : GROUPS;

export default function SettingsForm({ ev, raw }: { ev: string; raw: Record<string, string> }) {
  const [name, setName] = useState('');
  return (
    <section className="rounded-xl border border-sand-200 bg-white p-4 text-navy-700">
      <h2 className="text-lg font-bold">設定</h2>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span>1つずつ保存します。直す人：</span>
        <StaffNamePicker value={name} onChange={setName} />
      </div>

      <div className="mt-4 space-y-6">
        {ALL_GROUPS.map((g) => (
          <div key={g.title}>
            <h3 className="border-b border-sand-200 pb-1 font-bold">{g.title}</h3>
            <div className="mt-2 space-y-4">
              {g.fields.map((f) => (
                <SettingRow key={f.key} ev={ev} field={f} initial={raw[f.key] ?? ''} name={name} />
              ))}
            </div>
          </div>
        ))}

        <div>
          <h3 className="border-b border-sand-200 pb-1 font-bold">見るだけ（この画面では直せない）</h3>
          <dl className="mt-2 space-y-2 text-sm">
            {READ_ONLY.map((r) => (
              <div key={r.key}>
                <dt className="text-xs text-sand-800">{r.label}</dt>
                <dd className="break-words font-bold">{(raw[r.key] ?? '') === '' ? '（空）' : raw[r.key]}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </section>
  );
}

function SettingRow({ ev, field, initial, name }: { ev: string; field: Field; initial: string; name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState(false);
  const [pending, startTransition] = useTransition();
  const changed = value !== saved;
  const hint = HINT[field.kind];

  const save = () => {
    if (!name) { setError('名前を選んでください'); return; }
    startTransition(async () => {
      const r = await saveSettingAction(ev, field.key, value, name);
      if (!r.ok) { setError(r.error); setOkMsg(false); return; }
      const v = value.trim();
      setValue(v);
      setSaved(v);
      setError('');
      setOkMsg(true);
      router.refresh();
    });
  };

  const onChange = (v: string) => { setValue(v); setOkMsg(false); };

  return (
    <div>
      <label className="block">
        <span className="block text-sm font-bold">{field.label}</span>
        <span className="block text-xs text-sand-800">
          <code>{field.key}</code>
          {hint && `・${hint}`}
        </span>
        {field.note && <span className="mt-0.5 block text-xs font-bold text-red-700">{field.note}</span>}
        {field.kind === 'longtext' ? (
          <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className={`mt-1 ${RECITAL_INPUT_CLS}`} />
        ) : field.kind === 'bool' ? (
          <select value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${RECITAL_INPUT_CLS}`}>
            <option value="0">0（しない）</option>
            <option value="1">1（する）</option>
          </select>
        ) : (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            inputMode={field.kind === 'int' ? 'numeric' : undefined}
            className={`mt-1 ${RECITAL_INPUT_CLS}`}
          />
        )}
      </label>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={pending || !changed} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50">
          保存
        </button>
        {changed && (
          <button type="button" onClick={() => { setValue(saved); setError(''); }} disabled={pending} className="rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-sm text-navy-700">
            元に戻す
          </button>
        )}
        {okMsg && !changed && <span className="text-sm text-brand-800">保存しました。</span>}
      </div>
      {error && <p className="mt-1 text-sm font-bold text-red-700">{error}</p>}
    </div>
  );
}
