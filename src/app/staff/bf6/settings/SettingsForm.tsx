'use client';

// BF6設定編集フォーム(スタッフ専用)。保存はServer Action経由。
import { useState, useTransition } from 'react';
import { staffSaveSettings, type Bf6SettingsForm } from '../actions';

const inputCls =
  'w-full rounded-lg border border-sand-300 bg-white px-3 py-2 text-sm text-navy-800 focus:border-brand-500 focus:outline-none';

export default function SettingsForm({ initial }: { initial: Bf6SettingsForm }) {
  const [form, setForm] = useState<Bf6SettingsForm>(initial);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      await staffSaveSettings(form);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    });
  }

  const num = (v: string) => Math.max(0, Number(v) || 0);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-sand-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-800">受付状態</h2>
        <div className="mt-3 space-y-2">
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={form.entryOpen} onChange={(e) => setForm({ ...form, entryOpen: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            バトルエントリーを受け付ける
          </label>
          <label className="flex items-center gap-2 text-sm text-navy-800">
            <input type="checkbox" checked={form.ticketOpen} onChange={(e) => setForm({ ...form, ticketOpen: e.target.checked })} className="h-4 w-4 accent-brand-600" />
            観覧チケットを販売する
          </label>
          <div className="grid grid-cols-2 gap-3 pt-1">
            <label className="block text-xs text-neutral-500">
              エントリー締切(この日まで受付)
              <input type="date" value={form.entryDeadline} onChange={(e) => setForm({ ...form, entryDeadline: e.target.value })} className={inputCls} />
            </label>
            <label className="block text-xs text-neutral-500">
              観覧販売締切
              <input type="date" value={form.ticketDeadline} onChange={(e) => setForm({ ...form, ticketDeadline: e.target.value })} className={inputCls} />
            </label>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-sand-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-800">定員</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['ビギナー部門', 'beginner'],
              ['小中学生部門', 'kids'],
              ['一般部門', 'general'],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block text-xs text-neutral-500">
              {label}
              <input
                type="number"
                value={form.capacity[key]}
                onChange={(e) => setForm({ ...form, capacity: { ...form.capacity, [key]: num(e.target.value) } })}
                className={inputCls}
              />
            </label>
          ))}
          <label className="block text-xs text-neutral-500">
            ホール定員(観覧上限計算)
            <input type="number" value={form.hallCapacity} onChange={(e) => setForm({ ...form, hallCapacity: num(e.target.value) })} className={inputCls} />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-sand-200 bg-white p-4">
        <h2 className="text-sm font-bold text-navy-800">料金(円)</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {(
            [
              ['エントリー基本(1部門)', 'entryBase'],
              ['追加部門ごと', 'entryPerExtraDivision'],
              ['事前決済割引', 'prepaidDiscount'],
              ['観覧大人(前売)', 'ticketAdultPrepaid'],
              ['観覧大人(当日)', 'ticketAdultOnsite'],
              ['観覧小学生', 'ticketChild'],
              ['配信チケット', 'stream'],
              ['ショーケース(予約)', 'showcase'],
            ] as const
          ).map(([label, key]) => (
            <label key={key} className="block text-xs text-neutral-500">
              {label}
              <input
                type="number"
                value={form.pricing[key]}
                onChange={(e) => setForm({ ...form, pricing: { ...form.pricing, [key]: num(e.target.value) } })}
                className={inputCls}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-neutral-400">
          ※ 料金変更は変更後の新規申込から適用。申込済みの注文金額は変わりません
        </p>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {pending ? '保存中…' : '保存する'}
        </button>
        {saved && <span className="text-sm font-bold text-brand-600">✓ 保存しました</span>}
      </div>
    </div>
  );
}
