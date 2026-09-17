'use client';

// 予選通過者をタップで選ぶ。ちょうど8名でくじ引き②へ進める。
// 9人目は入らない(押し間違い防止)。外したいときはもう一度タップ。
import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  QUALIFIER_COUNT,
  QUALIFIER_PER_BLOCK,
  qualifierPickError,
  qualifiersReady,
  toggleQualifier,
} from '@/lib/bf6Qualifier';
import { crewSetQualifier } from './actions';
import { matchesAny } from '@/lib/bf6ListUi';
import { lineupForBlock } from '@/lib/bf6Lineup';

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
  // 予選1回ならA4名・B4名で確定する。2回やる場合は2次予選でA/Bが混ざるので上限を外す(TARO 2026-09-14)
  const [perBlock, setPerBlock] = useState(true);
  // 並ばせた順に見るか、名前で探すか。当日は並び順が主(TARO 2026-09-16)
  const [view, setView] = useState<'arc' | 'list'>('arc');
  const [pending, start] = useTransition();

  const ready = qualifiersReady(selected.size);

  const blockOf = (itemId: number) => candidates.find((c) => c.itemId === itemId)?.block ?? null;
  const selectedBlocks = [...selected].map(blockOf);

  const tap = (itemId: number) => {
    if (!selected.has(itemId)) {
      const why = qualifierPickError(selectedBlocks, blockOf(itemId), perBlock);
      if (why) {
        setErr(why);
        return;
      }
    }
    const next = toggleQualifier(selected, itemId);
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
        <p className="mt-2 text-sm font-bold tabular-nums text-navy-800">
          Aブロック {selectedBlocks.filter((b) => b === 'A').length}
          {perBlock ? ` / ${QUALIFIER_PER_BLOCK}` : ''}
          <span className="mx-2 text-neutral-400">|</span>
          Bブロック {selectedBlocks.filter((b) => b === 'B').length}
          {perBlock ? ` / ${QUALIFIER_PER_BLOCK}` : ''}
        </p>
        <button
          onClick={() => { setPerBlock((v) => !v); setErr(null); }}
          className="mt-2 text-xs font-bold text-neutral-500 underline"
        >
          {perBlock ? 'ブロックの上限を外す(予選を2回やる場合)' : 'ブロックの上限を戻す(各4名)'}
        </button>
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

      <div className="flex gap-2">
        {([
          { key: 'arc', label: '並び順' },
          { key: 'list', label: '名前で探す' },
        ] as const).map((v) => (
          <button
            key={v.key}
            onClick={() => setView(v.key)}
            className={`flex-1 rounded-xl py-2.5 text-sm font-black ${
              view === v.key ? 'bg-navy-900 text-white' : 'bg-sand-100 text-neutral-700'
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === 'arc' && (
        <>
          <p className="text-xs leading-relaxed text-neutral-600">
            この順番で左から並ばせてください。
            ジャッジが肩を叩いた人を、予選通過者としてチェックします。
          </p>

          {/* ⚠️ A・Bはそれぞれ独立した箱にする。1つの箱に両方入れると、どこまでが
                 どちらのブロックか分からない(TARO 2026-09-17)。
                 箱の中は「見出し → 並び → ジャッジ席」の順。ジャッジ席は両方に置く。 */}
          {(['A', 'B'] as const).map((b) => {
            const line = lineupForBlock(candidates, b);
            return (
              <section key={b} className="rounded-2xl border border-sand-200 bg-white p-3">
                <p className="mb-2 text-xs font-black tracking-widest text-neutral-500">
                  {b}ブロック · {line.length}名
                </p>

                {line.length === 0 ? (
                  <p className="py-2 text-sm font-bold text-neutral-400">
                    まだ誰も引いていません(受付のくじ引き①が済むと出ます)
                  </p>
                ) : (
                  // ⚠️ 横スクロールも折り返しもさせないこと。当日は一目で全員の並び順が
                  //    見えないと意味がない(TARO実機 2026-09-16)。1行に収めるため
                  //    1人ぶんの幅が狭くなるので、名前は縦書きにする。
                  <ul className="flex gap-1">
                    {line.map((c, i) => {
                      const on = selected.has(c.itemId);
                      return (
                        <li key={c.itemId} className="min-w-0 flex-1">
                          <button
                            disabled={pending}
                            onClick={() => tap(c.itemId)}
                            className={`flex w-full flex-col items-center gap-1 rounded-lg border-2 px-0.5 py-1.5 disabled:opacity-60 ${
                              on ? 'border-brand-600 bg-brand-600 text-white' : 'border-sand-300 bg-white text-navy-900'
                            }`}
                          >
                            <span
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-black tabular-nums ${
                                on ? 'bg-white text-brand-700' : 'bg-sand-100 text-neutral-600'
                              }`}
                            >
                              {i + 1}
                            </span>
                            <span className="max-h-[88px] overflow-hidden text-[11px] font-black leading-none [text-orientation:mixed] [writing-mode:vertical-rl]">
                              {c.dancerName}
                            </span>
                            <span className={`text-[10px] font-black leading-none ${on ? '' : 'invisible'}`}>✓</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <div className="mt-3 rounded-xl bg-navy-900 px-3 py-2 text-center text-white">
                  <p className="text-xs font-black tracking-widest">ジャッジ席</p>
                  <p className="mt-1 text-lg leading-none" aria-hidden>
                    🪑 🪑 🪑
                  </p>
                  <p className="mt-1 text-[11px] font-bold text-sand-200">
                    {b}ブロックは、この列を向いて並ぶ
                  </p>
                </div>
              </section>
            );
          })}
        </>
      )}

      {view === 'list' && (
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="名前で探す"
        className="w-full rounded-2xl border border-sand-300 bg-white px-4 py-3 text-base text-navy-900 placeholder:text-neutral-500"
        inputMode="search"
      />
      )}
      {view === 'list' && q.trim() && shown.length === 0 && (
        <p className="text-center text-sm font-bold text-neutral-600">見つかりません</p>
      )}

      {view === 'list' && (['A', 'B', null] as const).map((b) =>
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
