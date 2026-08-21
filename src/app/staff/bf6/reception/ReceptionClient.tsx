'use client';

// 当日の受付端末(iPad想定)。3〜4台で同時に使う。
// 設計方針: 迷わせない。検索して名前を押す → 部門ボタンを押す → 結果が大きく出る。
import { useMemo, useState, useTransition } from 'react';
import { receptionCollectCash, receptionDraw } from './actions';
import type { ReceptionEntrant } from '@/lib/bf6DrawDb';
import type { Bf6DrawDivision, Bf6DrawPhase } from '@/lib/bf6Draw';

const DIV_LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };
const yen = (n: number) => `¥${n.toLocaleString()}`;

type Drawn = { division: string; slotNo: number; block?: 'A' | 'B' };

export function ReceptionClient({ entrants, phase }: { entrants: ReceptionEntrant[]; phase: Bf6DrawPhase }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ReceptionEntrant | null>(null);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return entrants;
    return entrants.filter(
      (e) => e.dancerName.toLowerCase().includes(k) || e.performerName.toLowerCase().includes(k)
    );
  }, [entrants, q]);

  const done = entrants.filter((e) => e.checkedIn).length;

  function draw(e: ReceptionEntrant, division: string) {
    setErr(null);
    start(async () => {
      const r = await receptionDraw(e.itemId, division as Bf6DrawDivision, phase);
      if ('error' in r) { setErr(r.error); return; }
      setDrawn({ division, slotNo: r.slotNo, block: r.block });
    });
  }

  // 抽選結果の大画面表示
  if (sel && drawn) {
    const isBlock = drawn.block !== undefined;
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-navy-900 p-6 text-center text-white">
        <p className="text-lg font-bold text-sand-200">{sel.dancerName}</p>
        <p className="mt-1 text-sm text-sand-300">{DIV_LABEL[drawn.division]}部門</p>
        {isBlock ? (
          <>
            <p className="mt-8 text-2xl font-bold text-sand-200">予選ブロック</p>
            <p className="text-[10rem] font-black leading-none text-brand-400">{drawn.block}</p>
          </>
        ) : (
          <>
            <p className="mt-8 text-2xl font-bold text-sand-200">トーナメント</p>
            <p className="text-[10rem] font-black leading-none text-brand-400">{drawn.slotNo}</p>
            <p className="text-xl font-bold text-sand-200">番</p>
          </>
        )}
        <button
          onClick={() => { setDrawn(null); setSel(null); setQ(''); }}
          className="mt-12 w-full max-w-sm rounded-2xl bg-brand-600 py-5 text-xl font-black"
        >
          次の人へ
        </button>
      </div>
    );
  }

  // 選択中の人の部門選択
  if (sel) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white p-5">
        <button onClick={() => { setSel(null); setErr(null); }} className="self-start text-sm font-bold text-brand-600">
          ← 戻る
        </button>
        <p className="mt-4 text-3xl font-black text-navy-900">{sel.dancerName}</p>
        <p className="text-sm text-neutral-500">{sel.performerName}</p>

        {sel.amountDue > 0 && (
          <div className="mt-4 rounded-2xl border-2 border-red-500 bg-red-50 p-4">
            <p className="text-sm font-black text-red-700">当日現金 {yen(sel.amountDue)} を集金してください</p>
            <button
              onClick={() => start(async () => { await receptionCollectCash(sel.orderId); setSel({ ...sel, amountDue: 0 }); })}
              disabled={pending}
              className="mt-2 w-full rounded-xl bg-red-600 py-3 font-black text-white disabled:opacity-50"
            >
              受け取りました
            </button>
          </div>
        )}

        {err && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{err}</p>}

        <p className="mt-6 text-sm font-bold text-neutral-500">くじを引く部門を選ぶ</p>
        <div className="mt-2 space-y-3">
          {sel.divisions.map((d) => {
            const already = sel.draws.find((x) => x.division === d && x.phase === phase);
            return (
              <button
                key={d}
                onClick={() => draw(sel, d)}
                disabled={pending}
                className={`w-full rounded-2xl py-6 text-xl font-black disabled:opacity-50 ${
                  already ? 'bg-neutral-200 text-neutral-500' : 'bg-brand-600 text-white'
                }`}
              >
                {DIV_LABEL[d]}部門
                {already && (
                  <span className="ml-2 text-base">
                    済み({already.block ?? `${already.slotNo}番`})
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ダンサーネーム / 本名で検索"
          className="h-14 flex-1 rounded-2xl border border-sand-300 px-4 text-lg"
        />
        <span className="whitespace-nowrap text-sm font-bold text-neutral-500">
          受付 {done}/{entrants.length}
        </span>
      </div>

      <div className="space-y-2">
        {list.map((e) => (
          <button
            key={e.itemId}
            onClick={() => { setSel(e); setErr(null); }}
            className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left ${
              e.checkedIn ? 'border-sand-200 bg-sand-50' : 'border-sand-300 bg-white'
            }`}
          >
            <span>
              <span className="text-lg font-black text-navy-900">{e.dancerName}</span>
              <span className="ml-2 text-xs text-neutral-500">{e.performerName}</span>
              <span className="mt-0.5 block text-xs text-neutral-500">
                {e.divisions.map((d) => DIV_LABEL[d]).join(' / ')}
                {e.amountDue > 0 && <span className="ml-2 font-bold text-red-600">現金 {yen(e.amountDue)}</span>}
              </span>
            </span>
            <span className="text-right text-xs font-bold">
              {e.draws.filter((x) => x.phase === phase).length > 0 ? (
                <span className="text-brand-600">
                  {e.draws.filter((x) => x.phase === phase).map((x) => x.block ?? `${x.slotNo}番`).join(' / ')}
                </span>
              ) : e.checkedIn ? (
                <span className="text-neutral-400">受付済</span>
              ) : (
                <span className="text-neutral-300">未</span>
              )}
            </span>
          </button>
        ))}
        {list.length === 0 && <p className="p-6 text-center text-sm text-neutral-400">該当なし</p>}
      </div>
    </div>
  );
}
