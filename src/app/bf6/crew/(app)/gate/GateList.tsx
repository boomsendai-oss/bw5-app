'use client';

// 入場受付の一覧と当日券。
// タブ: 未入場 / 入場済み / 全員 / 当日券。全員ぶん渡すと「未入場」から消える。
// いちばん多いのは家族そろって来るケースなので、明細の主ボタンは「全員ぶん渡した」。
// 未払いなら「受け取って、渡した」を1回で済ませる(2段階だと分かりにくい・TARO実機 2026-09-11)。
// 係の名前は端末に覚えさせる(集金画面と同じキー)。
//
// ⚠️ サーバの値で rows を上書きし続けない(押した直後の状態が巻き戻る)。最新が要るときは開き直す。
// ⚠️ 色の指定が無い文字は白く溶ける(body の既定色が白)。数字や入力欄には必ず文字色を付ける。
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  clampHanded,
  filterGateTab,
  gateRemaining,
  gateTabCounts,
  gateTotals,
  matchesGateQuery,
  sortGateOrders,
  ticketCount,
  walkinLines,
  walkinTotals,
  WALKIN_MAX_PER_SALE,
  type GateOrder,
  type GateTab,
  type WalkinSale,
} from '@/lib/bf6Gate';
import { crewGateCollect, crewGateHand, crewWalkinSell, crewWalkinUndo } from './actions';

const YEN = (n: number) => `¥${n.toLocaleString()}`;
const NAME_STORE = 'bf6_cash_collector';
type View = GateTab | 'walkin';
const LIST_TABS: { key: GateTab; label: string }[] = [
  { key: 'todo', label: '未入場' },
  { key: 'done', label: '入場済み' },
  { key: 'all', label: '全員' },
];
const INPUT = 'w-full rounded-xl border border-sand-300 bg-white px-3 py-2 text-base text-navy-900 placeholder:text-neutral-500';
const time = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '';

function Stepper({ value, onChange, max, min = 0 }: { value: number; onChange: (n: number) => void; max: number; min?: number }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        aria-label="1つ減らす"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="h-12 w-12 rounded-full border border-sand-300 bg-white text-2xl font-black text-navy-900 active:bg-sand-100"
      >
        −
      </button>
      <span className="w-12 text-center text-4xl font-black tabular-nums text-navy-900">{value}</span>
      <button
        type="button"
        aria-label="1つ増やす"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-12 w-12 rounded-full border border-sand-300 bg-white text-2xl font-black text-navy-900 active:bg-sand-100"
      >
        ＋
      </button>
    </div>
  );
}

export default function GateList({
  orders,
  walkinSales,
  prices,
}: {
  orders: GateOrder[];
  walkinSales: WalkinSale[];
  prices: { adult: number; child: number };
}) {
  const [rows, setRows] = useState(orders);
  const [sales, setSales] = useState(walkinSales);
  const [view, setView] = useState<View>('todo');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [partial, setPartial] = useState(1);
  const [wAdult, setWAdult] = useState(0);
  const [wChild, setWChild] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    try {
      setWho(localStorage.getItem(NAME_STORE) ?? '');
    } catch {
      /* 覚えられなくても受付はできる */
    }
  }, []);
  const saveWho = (v: string) => {
    setWho(v);
    try {
      localStorage.setItem(NAME_STORE, v);
    } catch {
      /* noop */
    }
  };

  const t = gateTotals(rows);
  const counts = gateTabCounts(rows);
  const w = walkinTotals(sales);
  const listTab: GateTab = view === 'walkin' ? 'all' : view;
  const matched = useMemo(() => rows.filter((r) => matchesGateQuery(r, q)), [rows, q]);
  const shown = useMemo(() => sortGateOrders(filterGateTab(matched, listTab)), [matched, listTab]);
  // 探した人が別のタブにいるとき(もう入場済みなど)は、そちらに何件あるかを出す
  const elsewhere =
    q.trim() && shown.length === 0
      ? LIST_TABS.filter((x) => x.key !== listTab && x.key !== 'all')
          .map((x) => ({ ...x, n: filterGateTab(matched, x.key).length }))
          .filter((x) => x.n > 0)
      : [];
  const open = openId === null ? null : (rows.find((r) => r.orderId === openId) ?? null);

  const patch = (id: number, p: Partial<GateOrder>) =>
    setRows((rs) => rs.map((r) => (r.orderId === id ? { ...r, ...p } : r)));

  const openRow = (o: GateOrder) => {
    setErr(null);
    setNotice(null);
    setPartial(1);
    setOpenId(o.orderId);
  };

  const finishRow = (o: GateOrder) => {
    // 全員ぶん渡したら「未入場」から消えるので、明細を閉じて次のお客さんをすぐ探せるようにする
    setOpenId(null);
    setQ('');
    setNotice(`${o.buyerName} さん 入場済みにしました`);
  };

  /** リストバンドを渡す(delta本)。取り消しは負の数。 */
  const hand = (o: GateOrder, delta: number) => {
    setErr(null);
    const optimistic = clampHanded(o.handed + delta, ticketCount(o));
    patch(o.orderId, { handed: optimistic });
    if (delta > 0 && optimistic >= ticketCount(o)) finishRow(o);
    start(async () => {
      const r = await crewGateHand(o.orderId, delta, who);
      if (!r.ok) {
        setErr(r.error);
        patch(o.orderId, { handed: o.handed });
      } else {
        patch(o.orderId, { handed: r.handed });
      }
    });
  };

  /** 当日現金を受け取り、そのまま残りのリストバンドを全部渡す(1回で済ませる)。 */
  const collectAndHand = (o: GateOrder, handAll: boolean) => {
    setErr(null);
    const rest = gateRemaining(o);
    patch(o.orderId, { paid: true, amountDue: 0, ...(handAll ? { handed: ticketCount(o) } : {}) });
    if (handAll && rest > 0) finishRow(o);
    start(async () => {
      const c = await crewGateCollect(o.orderId, who);
      if (!c.ok) {
        setErr(c.error);
        patch(o.orderId, { paid: o.paid, amountDue: o.amountDue, handed: o.handed });
        return;
      }
      if (!handAll || rest === 0) return;
      const h = await crewGateHand(o.orderId, rest, who);
      if (!h.ok) {
        setErr(`受け取りは記録しました。リストバンドの記録に失敗しました: ${h.error}`);
        patch(o.orderId, { handed: o.handed });
      } else {
        patch(o.orderId, { handed: h.handed });
      }
    });
  };

  const sellWalkin = () => {
    setErr(null);
    const adult = wAdult;
    const child = wChild;
    start(async () => {
      const r = await crewWalkinSell(adult, child, who);
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      setSales((s) => [r.sale, ...s]);
      setWAdult(0);
      setWChild(0);
      setNotice(`当日券 ${walkinLines({ adult, child }, prices).map((l) => `${l.label}${l.qty}枚`).join('・')} ${YEN(r.sale.amount)} を記録しました`);
    });
  };

  const undoWalkin = (sale: WalkinSale) => {
    if (!confirm(`${time(sale.createdAt)} の当日券(${YEN(sale.amount)})を取り消しますか?`)) return;
    setErr(null);
    start(async () => {
      const r = await crewWalkinUndo(sale.id);
      if (!r.ok) setErr(r.error);
      else setSales((s) => s.filter((x) => x.id !== sale.id));
    });
  };

  const lines = walkinLines({ adult: wAdult, child: wChild }, prices);
  const walkinTotal = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="space-y-4 text-navy-900">
      <div className="rounded-2xl border border-sand-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-black tabular-nums text-navy-900">
            {t.handed}
            <span className="text-base font-bold text-neutral-500"> / {t.tickets} 枚</span>
          </p>
          <p className="text-sm font-black text-neutral-600">予約のお客さんの入場</p>
        </div>
        {t.unpaidOrders > 0 && (
          <p className="mt-1 text-sm font-bold text-orange-700">当日現金がまだの申込 {t.unpaidOrders} 件</p>
        )}
        <p className="mt-1 text-sm font-bold tabular-nums text-navy-800">
          当日券 {w.adult + w.child}枚 <span className="text-neutral-600">(中学生以上{w.adult}・小学生{w.child}) {YEN(w.amount)}</span>
        </p>
        <label className="mt-3 block">
          <span className="text-xs font-black text-neutral-600">受付係の名前(記録に残ります)</span>
          <input value={who} onChange={(e) => saveWho(e.target.value)} placeholder="例: TARO" className={`mt-1 ${INPUT}`} />
        </label>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {[...LIST_TABS.map((x) => ({ key: x.key as View, label: x.label, n: counts[x.key] })), { key: 'walkin' as View, label: '当日券', n: w.adult + w.child }].map((x) => (
          <button
            key={x.key}
            onClick={() => {
              setView(x.key);
              setOpenId(null);
            }}
            className={`rounded-xl py-3 text-[13px] font-black leading-tight tabular-nums transition active:scale-95 ${
              view === x.key
                ? x.key === 'walkin'
                  ? 'bg-orange-600 text-white'
                  : 'bg-navy-900 text-white'
                : x.key === 'walkin'
                  ? 'border border-orange-300 bg-orange-50 text-orange-800'
                  : 'bg-sand-100 text-navy-800'
            }`}
          >
            {x.label}
            <span className="block text-base">{x.n}</span>
          </button>
        ))}
      </div>

      {notice && <p className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white">{notice}</p>}
      {err && <p className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">{err}</p>}

      {view === 'walkin' ? (
        <>
          <section className="rounded-2xl border-2 border-orange-300 bg-white p-4">
            <p className="text-lg font-black text-navy-900">当日券を売る</p>
            <p className="text-xs text-neutral-600">予約なしで来たお客さん。枚数を選び、現金を受け取ってリストバンドを渡します</p>
            {[
              { label: '中学生以上', price: prices.adult, value: wAdult, set: setWAdult },
              { label: '小学生', price: prices.child, value: wChild, set: setWChild },
            ].map((row) => (
              <div key={row.label} className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-black text-navy-900">{row.label}</p>
                  <p className="text-xs tabular-nums text-neutral-600">1枚 {YEN(row.price)}</p>
                </div>
                <Stepper value={row.value} onChange={row.set} max={WALKIN_MAX_PER_SALE} />
              </div>
            ))}
            <div className="mt-4 rounded-xl bg-sand-50 p-3">
              <p className="text-xs font-black text-neutral-600">内訳</p>
              {lines.length === 0 ? (
                <p className="mt-1 text-sm text-neutral-600">枚数を選んでください</p>
              ) : (
                <ul className="mt-1 space-y-0.5">
                  {lines.map((l) => (
                    <li key={l.label} className="flex justify-between text-base tabular-nums text-navy-900">
                      <span>
                        {l.label} {YEN(l.unit)} × {l.qty}枚
                      </span>
                      <span className="font-bold">{YEN(l.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 flex justify-between border-t border-sand-300 pt-2 text-2xl font-black tabular-nums">
                <span className="text-navy-900">合計</span>
                <span className="text-orange-700">{YEN(walkinTotal)}</span>
              </p>
            </div>
            <button
              disabled={pending || lines.length === 0}
              onClick={sellWalkin}
              className="mt-4 w-full rounded-xl bg-orange-600 py-4 text-lg font-black text-white active:scale-95 disabled:opacity-40"
            >
              {lines.length === 0
                ? '枚数を選んでください'
                : `${YEN(walkinTotal)} 受け取って、リストバンドを${wAdult + wChild}本渡した`}
            </button>
          </section>

          <section className="rounded-2xl border border-sand-200 bg-white p-4">
            <p className="text-sm font-black text-navy-900">今日売った当日券 {w.sales}件</p>
            {sales.length === 0 ? (
              <p className="mt-2 text-sm text-neutral-600">まだありません</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {sales.map((sale) => (
                  <li key={sale.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="tabular-nums text-navy-900">
                      {time(sale.createdAt)} 中学生以上{sale.adult}
                      {sale.child > 0 ? `・小学生${sale.child}` : ''} {YEN(sale.amount)}
                      {sale.soldBy ? <span className="text-neutral-600"> / {sale.soldBy}</span> : null}
                    </span>
                    <button
                      disabled={pending}
                      onClick={() => undoWalkin(sale)}
                      className="shrink-0 rounded-lg border border-sand-300 bg-white px-3 py-1.5 text-xs font-bold text-neutral-700 disabled:opacity-50"
                    >
                      取り消す
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="名前・名字のひらがな・電話の下4桁で探す"
            className="w-full rounded-2xl border-2 border-navy-900 bg-white px-4 py-3 text-lg font-bold text-navy-900 placeholder:font-normal placeholder:text-neutral-500"
            inputMode="search"
          />
          <p className="-mt-2 text-[11px] text-neutral-600">名前の読み順(あいうえお順)に並んでいます</p>

          <ul className="space-y-2">
            {shown.map((o) => {
              const n = ticketCount(o);
              const done = o.handed >= n;
              return (
                <li key={o.orderId}>
                  <button
                    onClick={() => openRow(o)}
                    className={`w-full rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                      done ? 'border-sand-200 bg-sand-50' : o.paid ? 'border-sand-300 bg-white' : 'border-orange-300 bg-white'
                    }`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className={`text-lg font-black ${done ? 'text-neutral-500' : 'text-navy-900'}`}>
                        {done ? '✓ ' : ''}
                        {o.buyerName}
                      </span>
                      <span className={`shrink-0 text-sm font-black tabular-nums ${done ? 'text-neutral-500' : 'text-navy-900'}`}>
                        {o.handed} / {n} 本
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-neutral-600">
                      中学生以上{o.adult}
                      {o.child > 0 ? `・小学生${o.child}` : ''}
                      {o.people.length > 0 ? `  出場: ${o.people.join('・')}` : ''}
                    </p>
                    {!o.paid && <p className="mt-1 text-xs font-black text-orange-700">当日現金 {YEN(o.amountDue)} がまだ</p>}
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && (
              <li className="rounded-2xl border border-sand-200 bg-white p-6 text-center text-sm text-neutral-600">
                {elsewhere.length > 0 ? (
                  <>
                    このタブにはいません。
                    {elsewhere.map((x) => (
                      <button key={x.key} onClick={() => setView(x.key)} className="ml-2 font-black text-brand-700 underline">
                        {x.label}に{x.n}件
                      </button>
                    ))}
                  </>
                ) : q.trim() ? (
                  '見つかりません。名字のひらがなや電話番号の下4桁でも探せます。予約が無ければ「当日券」タブへ'
                ) : listTab === 'todo' ? (
                  '全員入場済みです'
                ) : (
                  'まだいません'
                )}
              </li>
            )}
          </ul>
        </>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-5 text-navy-900" onClick={(e) => e.stopPropagation()}>
            <p className="text-xl font-black text-navy-900">{open.buyerName}</p>
            <p className="mt-1 text-sm font-bold text-neutral-600">
              中学生以上{open.adult}
              {open.child > 0 ? `・小学生${open.child}` : ''}
              {open.people.length > 0 ? `  出場: ${open.people.join('・')}` : ''}
            </p>
            <p className="mt-3 text-sm font-bold text-neutral-600">
              リストバンド <span className="text-2xl font-black tabular-nums text-navy-900">{open.handed}</span>
              <span className="text-neutral-600"> / {ticketCount(open)} 本 渡し済み</span>
            </p>

            {!open.paid ? (
              <div className="mt-3">
                <ul className="space-y-1 border-t border-sand-200 pt-3">
                  {open.breakdown.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 text-sm text-navy-900">
                      <span>
                        {l.label}
                        {l.qty > 1 ? ` ×${l.qty}` : ''}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums">{YEN(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between border-t border-sand-200 pt-3 text-2xl font-black">
                  <span className="text-navy-900">合計</span>
                  <span className="tabular-nums text-orange-700">{YEN(open.amountDue)}</span>
                </p>
                <button
                  disabled={pending}
                  onClick={() => collectAndHand(open, true)}
                  className="mt-4 w-full rounded-xl bg-orange-600 py-4 text-lg font-black leading-snug text-white active:scale-95 disabled:opacity-50"
                >
                  {gateRemaining(open) > 0
                    ? `${YEN(open.amountDue)} 受け取って、リストバンドを${gateRemaining(open)}本渡した`
                    : `${YEN(open.amountDue)} 受け取った`}
                </button>
                {gateRemaining(open) > 0 && (
                  <button
                    disabled={pending}
                    onClick={() => collectAndHand(open, false)}
                    className="mt-2 w-full rounded-xl border border-sand-300 bg-white py-3 text-sm font-bold text-navy-800 disabled:opacity-50"
                  >
                    お金だけ受け取る(リストバンドはあとで)
                  </button>
                )}
              </div>
            ) : gateRemaining(open) > 0 ? (
              <div className="mt-3">
                <button
                  disabled={pending}
                  onClick={() => hand(open, gateRemaining(open))}
                  className="w-full rounded-xl bg-brand-600 py-4 text-lg font-black text-white active:scale-95 disabled:opacity-50"
                >
                  {open.handed === 0
                    ? `全員ぶん リストバンドを${gateRemaining(open)}本渡した`
                    : `残りの リストバンドを${gateRemaining(open)}本渡した`}
                </button>
                {gateRemaining(open) > 1 && (
                  <details className="mt-3 rounded-xl border border-sand-200 p-3">
                    <summary className="cursor-pointer text-sm font-bold text-navy-800">家族の一部だけ来た(本数を選ぶ)</summary>
                    <p className="mt-3 text-xs font-bold text-neutral-600">今渡す本数</p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <Stepper value={partial} onChange={setPartial} max={gateRemaining(open) - 1} min={1} />
                      <button
                        disabled={pending}
                        onClick={() => hand(open, partial)}
                        className="rounded-xl bg-navy-900 px-4 py-3 text-base font-black text-white disabled:opacity-50"
                      >
                        {partial}本だけ渡した
                      </button>
                    </div>
                  </details>
                )}
              </div>
            ) : (
              <p className="mt-3 rounded-xl bg-sand-100 p-3 text-center text-sm font-bold text-navy-800">全員ぶん渡し済みです</p>
            )}

            {open.handed > 0 && (
              <button
                disabled={pending}
                onClick={() => hand(open, -1)}
                className="mt-3 w-full py-2 text-xs font-bold text-neutral-600 underline"
              >
                押し間違えたので1本ぶん取り消す(いま {open.handed} 本)
              </button>
            )}
            <button onClick={() => setOpenId(null)} className="mt-1 w-full py-3 text-sm font-bold text-neutral-600">
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
