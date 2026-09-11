'use client';

// 集金の一覧。タップ→内訳を見て金額を確認→「受け取った」で記録。
// 係の名前は端末に覚えさせる(毎回打たせない)。
import { useEffect, useState, useTransition } from 'react';
import { cashTotals, sortCashOrders, type CashOrder } from '@/lib/bf6Cash';
import { crewRecordCash, crewUndoCash } from './actions';

const YEN = (n: number) => `¥${n.toLocaleString()}`;
const NAME_STORE = 'bf6_cash_collector';

export default function CashList({ orders }: { orders: CashOrder[] }) {
  const [rows, setRows] = useState(orders);
  const [who, setWho] = useState('');
  const [open, setOpen] = useState<CashOrder | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // ⚠️ orders(サーバの値)で rows を上書きし続けない。
  // 集金するたびにサーバ側が再描画されると、押した直後の状態が巻き戻る。
  // 最新の状態が要るときはページを開き直す。
  useEffect(() => {
    try {
      setWho(localStorage.getItem(NAME_STORE) ?? '');
    } catch {
      /* プライベートモード等では覚えないだけ */
    }
  }, []);

  const saveWho = (v: string) => {
    setWho(v);
    try {
      localStorage.setItem(NAME_STORE, v);
    } catch {
      /* 覚えられなくても集金はできる */
    }
  };

  const t = cashTotals(rows);
  const sorted = sortCashOrders(rows);

  const record = (o: CashOrder, amount: number) => {
    setErr(null);
    const at = new Date().toISOString();
    setRows((rs) => rs.map((r) => (r.orderId === o.orderId ? { ...r, collected: { amount, at, by: who } } : r)));
    setOpen(null);
    start(async () => {
      const res = await crewRecordCash(o.orderId, amount, who);
      if (!res.ok) {
        setErr(res.error);
        setRows((rs) => rs.map((r) => (r.orderId === o.orderId ? { ...r, collected: o.collected } : r)));
      }
    });
  };

  const undo = (o: CashOrder) => {
    setErr(null);
    setRows((rs) => rs.map((r) => (r.orderId === o.orderId ? { ...r, collected: null } : r)));
    setOpen(null);
    start(async () => {
      const res = await crewUndoCash(o.orderId);
      if (!res.ok) {
        setErr(res.error);
        setRows((rs) => rs.map((r) => (r.orderId === o.orderId ? { ...r, collected: o.collected } : r)));
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-sand-200 bg-white p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-3xl font-black tabular-nums text-navy-900">
            {YEN(t.collectedYen)}
            <span className="text-base font-bold text-neutral-400"> / {YEN(t.dueYen)}</span>
          </p>
          <p className="text-sm font-black text-neutral-500 tabular-nums">
            {t.collectedOrders} / {t.orders} 件
          </p>
        </div>
        <p className="mt-1 text-sm font-bold text-orange-600 tabular-nums">
          残り {YEN(t.remainingYen)}
        </p>
        {t.shortOrders > 0 && (
          <p className="mt-1 text-xs font-bold text-orange-600">
            請求額に足りていない記録が {t.shortOrders} 件あります
          </p>
        )}
        <label className="mt-3 block">
          <span className="text-xs font-black text-neutral-500">集金係の名前(記録に残ります)</span>
          <input
            value={who}
            onChange={(e) => saveWho(e.target.value)}
            placeholder="例: TARO"
            className="mt-1 w-full rounded-xl border border-sand-300 bg-white px-3 py-2 text-base text-navy-900 placeholder:text-neutral-500"
          />
        </label>
      </div>

      {err && <p className="rounded-lg bg-red-600 px-3 py-2 text-sm font-bold text-white">{err}</p>}

      {sorted.length === 0 && (
        <p className="rounded-2xl border border-sand-200 bg-white p-6 text-center text-sm text-neutral-500">
          当日現金の人はいません
        </p>
      )}

      <ul className="space-y-2">
        {sorted.map((o) => {
          const done = o.collected;
          return (
            <li key={o.orderId}>
              <button
                onClick={() => setOpen(o)}
                className={`w-full rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                  done ? 'border-sand-200 bg-sand-50' : 'border-orange-300 bg-white'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-lg font-black ${done ? 'text-neutral-400' : 'text-navy-900'}`}>
                    {done ? '✓ ' : ''}
                    {o.buyerName}
                  </span>
                  <span
                    className={`shrink-0 text-lg font-black tabular-nums ${
                      done ? 'text-neutral-400' : 'text-orange-600'
                    }`}
                  >
                    {YEN(done ? done.amount : o.amountDue)}
                  </span>
                </div>
                {o.people.length > 0 && (
                  <p className="mt-1 text-xs font-bold text-neutral-500">{o.people.join('・')}</p>
                )}
                {done && (
                  <p className="mt-1 text-xs text-neutral-400">
                    {new Date(done.at).toLocaleTimeString('ja-JP', {
                      hour: '2-digit',
                      minute: '2-digit',
                      timeZone: 'Asia/Tokyo',
                    })}
                    {done.by ? ` ${done.by} が受け取り` : ' 受け取り'}
                    {done.amount < o.amountDue ? ` / 請求 ${YEN(o.amountDue)}` : ''}
                  </p>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3" onClick={() => setOpen(null)}>
          <div
            className="w-full max-w-md rounded-3xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xl font-black text-navy-900">{open.buyerName}</p>
            {open.people.length > 0 && (
              <p className="mt-1 text-sm font-bold text-neutral-500">{open.people.join('・')}</p>
            )}
            <ul className="mt-4 space-y-1 border-t border-sand-200 pt-3">
              {open.breakdown.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 text-sm">
                  <span className="text-neutral-600">
                    {l.label}
                    {l.qty > 1 ? ` ×${l.qty}` : ''}
                  </span>
                  <span className="shrink-0 font-bold tabular-nums text-navy-900">{YEN(l.amount)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 flex justify-between border-t border-sand-200 pt-3 text-2xl font-black text-navy-900">
              <span>合計</span>
              <span className="tabular-nums text-orange-600">{YEN(open.amountDue)}</span>
            </p>

            {open.collected ? (
              <div className="mt-5 space-y-2">
                <p className="text-center text-sm font-bold text-neutral-500">
                  {YEN(open.collected.amount)} を受け取り済みです
                </p>
                <button
                  disabled={pending}
                  onClick={() => undo(open)}
                  className="w-full rounded-xl border border-sand-300 py-3 text-sm font-black text-neutral-600"
                >
                  受け取りを取り消す
                </button>
              </div>
            ) : (
              <button
                disabled={pending}
                onClick={() => record(open, open.amountDue)}
                className="mt-5 w-full rounded-xl bg-orange-600 py-4 text-lg font-black text-white active:scale-95"
              >
                {YEN(open.amountDue)} 受け取った
              </button>
            )}
            <button
              onClick={() => setOpen(null)}
              className="mt-2 w-full py-3 text-sm font-bold text-neutral-400"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
