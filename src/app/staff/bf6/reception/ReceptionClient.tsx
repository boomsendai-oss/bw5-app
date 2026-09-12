'use client';

// 当日の受付端末(iPad・スタッフのスマホ)。3〜4台で同時に使う。
// 設計方針: 迷わせない。タブで部門を選ぶ → 名前を押す → その部門のくじを引く → 結果が大きく出る。
//
// 部門のタブ(TARO 2026-09-11): 全部門が1つの一覧に混ざっていると、名前を押してから部門を選ぶ手間があり
// 押し間違いも起きる。タブの部門の人だけを並べ、明細にはその部門のくじのボタンだけを出す。
// 選んだタブはURL(?d=)に残すので、「このiPadは小中担当」のように端末ごとに固定できる。
//
// ⚠️ 色の指定が無い文字は白く溶ける(body の既定色が白)。文字には必ず色を付ける。
import PhotoCapture from './PhotoCapture';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { receptionCollectCash, receptionDraw } from './actions';
import type { ReceptionEntrant } from '@/lib/bf6DrawDb';
import type { Bf6DrawDivision, Bf6DrawPhase } from '@/lib/bf6Draw';
import { divisionsForPhase, drawFor, entrantsInDivision, receptionTabs } from '@/lib/bf6Reception';
import { matchesAny } from '@/lib/bf6ListUi';

const DIV_LABEL: Record<string, string> = { beginner: 'ビギナー', kids: '小中学生', general: '一般' };
const yen = (n: number) => `¥${n.toLocaleString()}`;

type Drawn = { division: string; slotNo: number; block?: 'A' | 'B' };

export function ReceptionClient({
  entrants,
  phase,
  photoItemIds,
  initialDivision,
}: {
  entrants: ReceptionEntrant[];
  phase: Bf6DrawPhase;
  photoItemIds: number[];
  /** URLの ?d= で開いたときの部門 */
  initialDivision?: string;
}) {
  const router = useRouter();
  const photoSet = useMemo(() => new Set(photoItemIds), [photoItemIds]);
  const divisions = divisionsForPhase(phase);
  const [division, setDivision] = useState(
    initialDivision && divisions.includes(initialDivision) ? initialDivision : divisions[0]
  );
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<ReceptionEntrant | null>(null);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // 選んだタブをURLに残す(再読み込みしても同じ部門のまま)。サーバの再取得はしない
  useEffect(() => {
    const u = new URL(window.location.href);
    if (u.searchParams.get('d') === division) return;
    u.searchParams.set('d', division);
    window.history.replaceState(null, '', u.toString());
  }, [division]);

  const tabs = receptionTabs(entrants, phase);
  const inDivision = useMemo(() => entrantsInDivision(entrants, division), [entrants, division]);
  // カタカナ・ひらがな・全角のどれで打っても当たるようにする(当日は急いで打つ)
  const list = useMemo(
    () => inDivision.filter((e) => matchesAny([e.dancerName, e.performerName], q)),
    [inDivision, q]
  );

  function draw(e: ReceptionEntrant) {
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
          onClick={() => { setDrawn(null); setSel(null); setQ(''); router.refresh(); }}
          className="mt-12 w-full max-w-sm rounded-2xl bg-brand-600 py-5 text-xl font-black text-white"
        >
          次の人へ
        </button>
      </div>
    );
  }

  // 選んだ人: タブの部門のくじだけを出す
  if (sel) {
    const already = drawFor(sel, division, phase);
    const others = sel.divisions.filter((d) => d !== division);
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white p-5 text-navy-900">
        <button onClick={() => { setSel(null); setErr(null); }} className="self-start text-sm font-bold text-brand-700">
          ← 戻る
        </button>
        <p className="mt-4 text-3xl font-black text-navy-900">{sel.dancerName}</p>
        <p className="text-sm text-neutral-600">{sel.performerName}</p>

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

        <button
          onClick={() => draw(sel)}
          disabled={pending || already !== null}
          className={`mt-6 w-full rounded-2xl py-7 text-2xl font-black disabled:opacity-60 ${
            already ? 'bg-neutral-200 text-neutral-600' : 'bg-brand-600 text-white'
          }`}
        >
          {already
            ? `${DIV_LABEL[division]}部門 引き済み(${already.block ?? `${already.slotNo}番`})`
            : `${DIV_LABEL[division]}部門のくじを引く`}
        </button>
        {others.length > 0 && (
          <p className="mt-3 text-sm font-bold text-neutral-600">
            この人は {others.map((d) => `${DIV_LABEL[d]}部門`).join('・')} にも出ます。そちらのタブで引いてください
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 text-navy-900">
      <div className={`grid gap-2 ${divisions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {tabs.map((t) => (
          <button
            key={t.division}
            onClick={() => { setDivision(t.division); setQ(''); }}
            className={`rounded-xl py-3 text-sm font-black leading-tight tabular-nums transition active:scale-95 ${
              division === t.division ? 'bg-navy-900 text-white' : 'bg-sand-100 text-navy-800'
            }`}
          >
            {t.label}
            <span className="block text-base">
              くじ {t.drawn}/{t.total}
            </span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="名前で探す(ダンサーネーム・本名)"
          className="h-14 flex-1 rounded-2xl border border-sand-300 bg-white px-4 text-lg text-navy-900 placeholder:text-neutral-500"
        />
      </div>

      <div className="space-y-2">
        {list.map((e) => {
          const d = drawFor(e, division, phase);
          const others = e.divisions.filter((x) => x !== division);
          return (
            <div
              key={e.itemId}
              className={`rounded-2xl border ${d ? 'border-sand-200 bg-sand-50' : 'border-sand-300 bg-white'}`}
            >
              <button
                onClick={() => { setSel(e); setErr(null); }}
                className="flex w-full items-center justify-between p-4 text-left"
              >
                <span>
                  <span className="text-lg font-black text-navy-900">{e.dancerName}</span>
                  <span className="ml-2 text-xs text-neutral-600">{e.performerName}</span>
                  <span className="mt-0.5 block text-xs text-neutral-600">
                    {others.length > 0 && <>{others.map((x) => DIV_LABEL[x]).join('・')}部門にも出場</>}
                    {e.amountDue > 0 && <span className="ml-2 font-bold text-red-700">現金 {yen(e.amountDue)}</span>}
                  </span>
                </span>
                <span className="text-right text-sm font-black">
                  {d ? (
                    <span className="text-brand-700">{d.block ?? `${d.slotNo}番`}</span>
                  ) : e.checkedIn ? (
                    <span className="text-neutral-600">受付済・くじまだ</span>
                  ) : (
                    <span className="text-neutral-600">未受付</span>
                  )}
                </span>
              </button>
              <div className="border-t border-sand-100 px-4 py-2">
                <PhotoCapture
                  itemId={e.itemId}
                  dancerName={e.dancerName}
                  hasPhoto={photoSet.has(e.itemId)}
                  onDone={() => router.refresh()}
                />
              </div>
            </div>
          );
        })}
        {list.length === 0 && (
          <p className="p-6 text-center text-sm text-neutral-600">
            {inDivision.length === 0 ? `${DIV_LABEL[division]}部門の対象者はいません` : '該当なし'}
          </p>
        )}
      </div>
    </div>
  );
}
