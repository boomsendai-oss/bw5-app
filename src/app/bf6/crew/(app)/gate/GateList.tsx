'use client';

// 入場受付の一覧。名前で探す → タップ → (未払いなら受け取る) → 渡した枚数を記録。
// 係の名前は端末に覚えさせる(集金画面と同じキーを使い、同じ人なら打ち直さなくてよい)。
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  gateTotals,
  matchesGateQuery,
  sortGateOrders,
  ticketCount,
  clampHanded,
  type GateOrder,
} from '@/lib/bf6Gate';
import { crewGateCollect, crewGateHand } from './actions';

const YEN = (n: number) => `¥${n.toLocaleString()}`;
const NAME_STORE = 'bf6_cash_collector';

export default function GateList({ orders }: { orders: GateOrder[] }) {
  // ⚠️ サーバの値で上書きし続けない(押した直後の状態が巻き戻る・集金画面で実証済)
  const [rows, setRows] = useState(orders);
  const [q, setQ] = useState('');
  const [who, setWho] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [count, setCount] = useState(1);
  const [err, setErr] = useState<string | null>(null);
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
  const shown = useMemo(() => sortGateOrders(rows.filter((r) => matchesGateQuery(r, q))), [rows, q]);
  const open = openId === null ? null : (rows.find((r) => r.orderId === openId) ?? null);

  const patch = (id: number, p: Partial<GateOrder>) =>
    setRows((rs) => rs.map((r) => (r.orderId === id ? { ...r, ...p } : r)));

  const openRow = (o: GateOrder) => {
    setErr(null);
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
      setOpenId(null);
      setQ(''); // 次のお客さんをすぐ探せるように
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

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sand-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-black tabular-nums text-navy-900">
            {t.handed}
            <span className="text-base font-bold text-neutral-400"> / {t.tickets} 枚</span>
          </p>
          <p className="text-sm font-black tabular-nums text-neutral-500">
            {t.doneOrders} / {t.orders} 件 入場済み
          </p>
        </div>
        {t.unpaidOrders > 0 && (
          <p className="mt-1 text-sm font-bold text-orange-600">当日現金がまだの申込 {t.unpaidOrders} 件</p>
        )}
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

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="名前・名字のひらがな・電話の下4桁で探す"
        className="w-full rounded-2xl border-2 border-navy-900 px-4 py-3 text-lg font-bold"
        inputMode="search"
      />

      {err && <p className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">{err}</p>}

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
                {!o.paid && (
                  <p className="mt-1 text-xs font-black text-orange-600">当日現金 {YEN(o.amountDue)} がまだ</p>
                )}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="rounded-2xl border border-sand-200 bg-white p-6 text-center text-sm text-neutral-500">
            見つかりません。名字のひらがなや電話番号の下4桁でも探せます
          </li>
        )}
      </ul>

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
                {open.handed > 0 && (
                  <button
                    disabled={pending}
                    onClick={() => hand(open, -1)}
                    className="mt-2 w-full py-2 text-xs font-bold text-neutral-400"
                  >
                    押し間違えたので1本ぶん取り消す
                  </button>
                )}
              </div>
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
