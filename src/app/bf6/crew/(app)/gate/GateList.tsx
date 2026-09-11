'use client';

// 入場受付の一覧と当日券。
// 名前で探す → タップ → (未払いなら受け取る) → 渡した本数を記録。渡し終わると「まだ」タブから消える。
// 予約なしのお客さんは「当日券を売る」から、枚数を選んで現金を受け取り記録する。
// 係の名前は端末に覚えさせる(集金画面と同じキー)。
//
// ⚠️ サーバの値で rows を上書きし続けない(押した直後の状態が巻き戻る)。最新が要るときは開き直す。
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  clampHanded,
  filterGateTab,
  gateTabCounts,
  gateTotals,
  matchesGateQuery,
  sortGateOrders,
  ticketCount,
  walkinTotals,
  WALKIN_MAX_PER_SALE,
  type GateOrder,
  type GateTab,
  type WalkinSale,
} from '@/lib/bf6Gate';
import { crewGateCollect, crewGateHand, crewWalkinSell, crewWalkinUndo } from './actions';

const YEN = (n: number) => `¥${n.toLocaleString()}`;
const NAME_STORE = 'bf6_cash_collector';
const TABS: { key: GateTab; label: string }[] = [
  { key: 'todo', label: 'まだ' },
  { key: 'done', label: '入場済み' },
  { key: 'all', label: '全員' },
];
const time = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' }) : '';

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
  const [tab, setTab] = useState<GateTab>('todo');
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [walkinOpen, setWalkinOpen] = useState(false);
  const [wAdult, setWAdult] = useState(1);
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
  const matched = useMemo(() => rows.filter((r) => matchesGateQuery(r, q)), [rows, q]);
  const shown = useMemo(() => sortGateOrders(filterGateTab(matched, tab)), [matched, tab]);
  // 探した人が別のタブにいるとき(もう入場済みなど)は、そちらに何件あるかを出す
  const elsewhere =
    q.trim() && shown.length === 0
      ? TABS.filter((x) => x.key !== tab && x.key !== 'all')
          .map((x) => ({ ...x, n: filterGateTab(matched, x.key).length }))
          .filter((x) => x.n > 0)
      : [];
  const open = openId === null ? null : (rows.find((r) => r.orderId === openId) ?? null);

  const patch = (id: number, p: Partial<GateOrder>) =>
    setRows((rs) => rs.map((r) => (r.orderId === id ? { ...r, ...p } : r)));

  const openRow = (o: GateOrder) => {
    setErr(null);
    setNotice(null);
    setCount(Math.max(1, ticketCount(o) - o.handed));
    setOpenId(o.orderId);
  };

  const collect = (o: GateOrder) => {
    setErr(null);
    patch(o.orderId, { paid: true, amountDue: 0 });
    start(async () => {
      const r = await crewGateCollect(o.orderId, who);
      if (!r.ok) {
        setErr(r.error);
        patch(o.orderId, { paid: o.paid, amountDue: o.amountDue });
      }
    });
  };

  const hand = (o: GateOrder, delta: number) => {
    setErr(null);
    const optimistic = clampHanded(o.handed + delta, ticketCount(o));
    patch(o.orderId, { handed: optimistic });
    if (delta > 0 && optimistic >= ticketCount(o)) {
      // 全員ぶん渡したら「まだ」から消えるので、明細を閉じて次のお客さんをすぐ探せるようにする
      setOpenId(null);
      setQ('');
      setNotice(`${o.buyerName} さん 入場済みにしました`);
    }
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
      setWalkinOpen(false);
      setWAdult(1);
      setWChild(0);
      setNotice(
        `当日券 大人${adult}${child > 0 ? `・小学生${child}` : ''} ${YEN(r.sale.amount)} を記録しました`
      );
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

  const walkinTotal = wAdult * prices.adult + wChild * prices.child;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sand-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-black tabular-nums text-navy-900">
            {t.handed}
            <span className="text-base font-bold text-neutral-400"> / {t.tickets} 枚</span>
          </p>
          <p className="text-sm font-black tabular-nums text-neutral-500">予約の入場</p>
        </div>
        {t.unpaidOrders > 0 && (
          <p className="mt-1 text-sm font-bold text-orange-600">当日現金がまだの申込 {t.unpaidOrders} 件</p>
        )}
        <p className="mt-1 text-sm font-bold tabular-nums text-navy-800">
          当日券 {w.adult + w.child}枚
          <span className="text-neutral-500">
            {' '}
            (大人{w.adult}・小学生{w.child}) {YEN(w.amount)}
          </span>
        </p>
        <label className="mt-3 block">
          <span className="text-xs font-black text-neutral-500">受付係の名前(記録に残ります)</span>
          <input
            value={who}
            onChange={(e) => saveWho(e.target.value)}
            placeholder="例: TARO"
            className="mt-1 w-full rounded-xl border border-sand-300 px-3 py-2 text-base"
          />
        </label>
      </div>

      <button
        onClick={() => {
          setErr(null);
          setNotice(null);
          setWalkinOpen(true);
        }}
        className="w-full rounded-2xl border-2 border-dashed border-orange-400 bg-orange-50 py-3 text-base font-black text-orange-700 active:scale-[0.99]"
      >
        ＋ 予約なしの方に当日券を売る
      </button>

      {notice && <p className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-bold text-white">{notice}</p>}
      {err && <p className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">{err}</p>}

      <div className="flex gap-2">
        {TABS.map((x) => (
          <button
            key={x.key}
            onClick={() => setTab(x.key)}
            className={`flex-1 rounded-xl py-3 text-sm font-black tabular-nums transition active:scale-95 ${
              tab === x.key ? 'bg-navy-900 text-white' : 'bg-sand-100 text-neutral-600'
            }`}
          >
            {x.label} {counts[x.key]}
          </button>
        ))}
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="名前・名字のひらがな・電話の下4桁で探す"
        className="w-full rounded-2xl border-2 border-navy-900 px-4 py-3 text-lg font-bold"
        inputMode="search"
      />
      <p className="-mt-2 text-[11px] text-neutral-400">名前の読み順(あいうえお順)に並んでいます</p>

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
                  <span className={`text-lg font-black ${done ? 'text-neutral-400' : 'text-navy-900'}`}>
                    {done ? '✓ ' : ''}
                    {o.buyerName}
                  </span>
                  <span className={`shrink-0 text-sm font-black tabular-nums ${done ? 'text-neutral-400' : 'text-navy-900'}`}>
                    {o.handed} / {n} 枚
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold text-neutral-500">
                  大人{o.adult}
                  {o.child > 0 ? `・小学生${o.child}` : ''}
                  {o.people.length > 0 ? `  出場: ${o.people.join('・')}` : ''}
                </p>
                {!o.paid && <p className="mt-1 text-xs font-black text-orange-600">当日現金 {YEN(o.amountDue)} がまだ</p>}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="rounded-2xl border border-sand-200 bg-white p-6 text-center text-sm text-neutral-500">
            {elsewhere.length > 0 ? (
              <>
                このタブにはいません。
                {elsewhere.map((x) => (
                  <button key={x.key} onClick={() => setTab(x.key)} className="ml-2 font-black text-brand-700 underline">
                    {x.label}に{x.n}件
                  </button>
                ))}
              </>
            ) : q.trim() ? (
              '見つかりません。名字のひらがなや電話番号の下4桁でも探せます。予約が無ければ当日券を売ってください'
            ) : tab === 'todo' ? (
              '全員入場済みです'
            ) : (
              'まだいません'
            )}
          </li>
        )}
      </ul>

      {sales.length > 0 && (
        <details className="rounded-2xl border border-sand-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-black text-navy-900">
            当日券の記録 {w.sales}件
          </summary>
          <ul className="mt-3 space-y-2">
            {sales.map((sale) => (
              <li key={sale.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="tabular-nums text-neutral-600">
                  {time(sale.createdAt)} 大人{sale.adult}
                  {sale.child > 0 ? `・小学生${sale.child}` : ''} {YEN(sale.amount)}
                  {sale.soldBy ? ` / ${sale.soldBy}` : ''}
                </span>
                <button
                  disabled={pending}
                  onClick={() => undoWalkin(sale)}
                  className="shrink-0 rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-neutral-600 disabled:opacity-50"
                >
                  取り消す
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {walkinOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3" onClick={() => setWalkinOpen(false)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-xl font-black text-navy-900">当日券を売る</p>
            <p className="mt-1 text-xs text-neutral-500">予約なしで来たお客さん。現金を受け取って、リストバンドを渡します</p>
            {[
              { label: '中学生以上', price: prices.adult, value: wAdult, set: setWAdult },
              { label: '小学生', price: prices.child, value: wChild, set: setWChild },
            ].map((line) => (
              <div key={line.label} className="mt-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-base font-black text-navy-900">{line.label}</p>
                  <p className="text-xs tabular-nums text-neutral-500">{YEN(line.price)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => line.set((v) => Math.max(0, v - 1))}
                    className="h-11 w-11 rounded-full bg-sand-100 text-2xl font-black"
                  >
                    −
                  </button>
                  <span className="w-10 text-center text-3xl font-black tabular-nums">{line.value}</span>
                  <button
                    onClick={() => line.set((v) => Math.min(WALKIN_MAX_PER_SALE, v + 1))}
                    className="h-11 w-11 rounded-full bg-sand-100 text-2xl font-black"
                  >
                    ＋
                  </button>
                </div>
              </div>
            ))}
            <p className="mt-4 flex justify-between border-t border-sand-200 pt-3 text-2xl font-black">
              <span>合計</span>
              <span className="tabular-nums text-orange-600">{YEN(walkinTotal)}</span>
            </p>
            <button
              disabled={pending || wAdult + wChild === 0}
              onClick={sellWalkin}
              className="mt-4 w-full rounded-xl bg-orange-600 py-4 text-lg font-black text-white active:scale-95 disabled:opacity-50"
            >
              {YEN(walkinTotal)} 受け取って、{wAdult + wChild}本渡した
            </button>
            <button onClick={() => setWalkinOpen(false)} className="mt-2 w-full py-3 text-sm font-bold text-neutral-400">
              閉じる
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3" onClick={() => setOpenId(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="text-xl font-black text-navy-900">{open.buyerName}</p>
            <p className="mt-1 text-sm font-bold text-neutral-500">
              大人{open.adult}
              {open.child > 0 ? `・小学生${open.child}` : ''}
              {open.people.length > 0 ? `  出場: ${open.people.join('・')}` : ''}
            </p>

            {!open.paid ? (
              <div className="mt-4">
                <ul className="space-y-1 border-t border-sand-200 pt-3">
                  {open.breakdown.map((l, i) => (
                    <li key={i} className="flex justify-between gap-3 text-sm">
                      <span className="text-neutral-600">
                        {l.label}
                        {l.qty > 1 ? ` ×${l.qty}` : ''}
                      </span>
                      <span className="shrink-0 font-bold tabular-nums">{YEN(l.amount)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 flex justify-between border-t border-sand-200 pt-3 text-2xl font-black">
                  <span>合計</span>
                  <span className="tabular-nums text-orange-600">{YEN(open.amountDue)}</span>
                </p>
                <button
                  disabled={pending}
                  onClick={() => collect(open)}
                  className="mt-4 w-full rounded-xl bg-orange-600 py-4 text-lg font-black text-white active:scale-95 disabled:opacity-50"
                >
                  {YEN(open.amountDue)} 受け取った
                </button>
                <p className="mt-2 text-center text-xs text-neutral-500">受け取ってからリストバンドを渡せます</p>
              </div>
            ) : (
              <div className="mt-4">
                <p className="text-sm font-bold text-neutral-600">
                  渡した数 <span className="text-2xl font-black tabular-nums text-navy-900">{open.handed}</span>
                  <span className="text-neutral-400"> / {ticketCount(open)} 枚</span>
                </p>
                {open.handed < ticketCount(open) ? (
                  <>
                    <div className="mt-3 flex items-center justify-center gap-4">
                      <button
                        onClick={() => setCount((c) => Math.max(1, c - 1))}
                        className="h-12 w-12 rounded-full bg-sand-100 text-2xl font-black"
                      >
                        −
                      </button>
                      <span className="w-16 text-center text-4xl font-black tabular-nums">{count}</span>
                      <button
                        onClick={() => setCount((c) => Math.min(ticketCount(open) - open.handed, c + 1))}
                        className="h-12 w-12 rounded-full bg-sand-100 text-2xl font-black"
                      >
                        ＋
                      </button>
                    </div>
                    <button
                      disabled={pending}
                      onClick={() => hand(open, count)}
                      className="mt-4 w-full rounded-xl bg-brand-600 py-4 text-lg font-black text-white active:scale-95 disabled:opacity-50"
                    >
                      リストバンドを {count} 本渡した
                    </button>
                  </>
                ) : (
                  <p className="mt-3 rounded-xl bg-sand-100 p-3 text-center text-sm font-bold text-neutral-600">
                    全員ぶん渡し済みです
                  </p>
                )}
              </div>
            )}
            {/* 未払いに戻っていても、渡した本数は直せるようにする(集金を取り消した後など) */}
            {open.handed > 0 && (
              <button
                disabled={pending}
                onClick={() => hand(open, -1)}
                className="mt-2 w-full py-2 text-xs font-bold text-neutral-400"
              >
                押し間違えたので1本ぶん取り消す(いま {open.handed} 本)
              </button>
            )}
            <button onClick={() => setOpenId(null)} className="mt-2 w-full py-3 text-sm font-bold text-neutral-400">
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
