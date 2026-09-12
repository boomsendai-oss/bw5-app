'use client';

// 予選通過者をタップで選ぶ。ちょうど8名でくじ引き②へ進める。
// 9人目は入らない(押し間違い防止)。外したいときはもう一度タップ。
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { QUALIFIER_COUNT, qualifiersReady, toggleQualifier } from '@/lib/bf6Qualifier';
import { crewSetQualifier } from './actions';
import { matchesAny } from '@/lib/bf6ListUi';

export type Candidate = { itemId: number; dancerName: string; block: 'A' | 'B' | null };

export default function QualifierPicker({
  division,
  divisionLabel,
  candidates,
  initialSelected,
}: {
  division: string;
  divisionLabel: string;
  candidates: Candidate[];
  initialSelected: number[];
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set(initialSelected));
  const [err, setErr] = useState<string | null>(null);
  // MCが読み上げた名前をその場で探す。26人を目で追うのは当日きつい(2026-09-11)
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();

  const ready = qualifiersReady(selected.size);

  const tap = (itemId: number) => {
    const next = toggleQualifier(selected, itemId);
    if (next.size === selected.size && !selected.has(itemId)) {
      setErr(`${QUALIFIER_COUNT}名までです。外してから選び直してください`);
      return;
    }
    setErr(null);
    setSelected(next); // 先に画面へ反映(押した感触を返す)
    start(async () => {
      const r = await crewSetQualifier(division, itemId, next.has(itemId));
      if (!r.ok) {
        setErr(r.error);
        setSelected(selected); // 失敗したら戻す
      }
    });
  };

  const shown = candidates.filter((c) => matchesAny([c.dancerName], q));
  const byBlock = (b: 'A' | 'B' | null) => shown.filter((c) => c.block === b);

  return (
    <div className="space-y-4">
      <div
        className={`rounded-2xl border p-4 ${
          ready ? 'border-brand-500 bg-brand-50' : 'border-sand-200 bg-white'
        }`}
      >
        <p className="text-2xl font-black text-navy-900">
          {selected.size}
          <span className="text-base font-bold text-neutral-400"> / {QUALIFIER_COUNT} 名</span>
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {ready
            ? 'そろいました。くじ引き②に進めます。'
            : `ジャッジの結果を見ながら、通過した${QUALIFIER_COUNT}名をタップしてください。`}
        </p>
        {ready && (
          <Link
            href={`/bf6/crew/reception?phase=bracket`}
            className="mt-3 block rounded-xl bg-brand-600 py-3 text-center text-sm font-black text-white"
          >
            {divisionLabel}のくじ引き②(ベスト8)へ
          </Link>
        )}
      </div>

      {err && <p className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">{err}</p>}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="名前で探す"
        className="w-full rounded-2xl border border-sand-300 bg-white px-4 py-3 text-base text-navy-900 placeholder:text-neutral-500"
        inputMode="search"
      />
      {q.trim() && shown.length === 0 && (
        <p className="text-center text-sm font-bold text-neutral-600">見つかりません</p>
      )}

      {(['A', 'B', null] as const).map((b) =>
        byBlock(b).length === 0 ? null : (
          <section key={String(b)}>
            <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">
              {b ? `${b}ブロック` : 'ブロック未定(受付をしていない人)'}
            </p>
            <ul className="grid grid-cols-2 gap-2">
              {byBlock(b).map((c) => {
                const on = selected.has(c.itemId);
                return (
                  <li key={c.itemId}>
                    <button
                      disabled={pending}
                      onClick={() => tap(c.itemId)}
                      className={`w-full rounded-xl border px-3 py-3 text-left text-base font-black ${
                        on
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-sand-300 bg-white text-navy-900'
                      }`}
                    >
                      {on ? '✓ ' : ''}
                      {c.dancerName}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )
      )}
    </div>
  );
}
