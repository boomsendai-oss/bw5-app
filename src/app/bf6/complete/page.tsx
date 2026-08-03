// ⚠️ 公開ページ(認証なし)。理由: BF6エントリー完了画面。edit_token完全一致の
// 自分の申込1件のみ表示する(列挙不可・トークンなしでは何も出さない)。
import Link from 'next/link';
import { formatReceiptNo, bf6DivisionLabel, bf6GradeLabel } from '@/lib/bf6';
import { loadBf6OrderByToken } from '@/lib/bf6Db';
import CheckoutButton from './CheckoutButton';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default async function Bf6CompletePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const order = t ? await loadBf6OrderByToken(t) : null;

  if (!order) {
    return (
      <Shell>
        <h1 className="text-2xl font-black text-white">申込が見つかりません</h1>
        <p className="mt-4 text-zinc-400">
          URLが正しいかご確認ください。30分以内に決済されなかった申込は無効になります。
        </p>
        <Link href="/bf6/entry" className="mt-6 block w-full rounded-xl bg-red-600 py-4 text-center text-lg font-black text-white">
          もう一度エントリーする
        </Link>
      </Shell>
    );
  }

  const st = order.paymentStatus;
  const entries = order.items.filter((i) => i.itemType === 'entry');
  const adult = order.items.find((i) => i.itemType === 'ticket_adult');
  const child = order.items.find((i) => i.itemType === 'ticket_child');

  return (
    <Shell>
      {st === 'paid' || st === 'cash_due' ? (
        <>
          <h1 className="text-2xl font-black text-white">エントリー完了!</h1>
          <p className="mt-2 rounded-xl bg-red-950/50 p-4 text-center">
            <span className="text-sm text-zinc-400">受付番号</span>
            <span className="block text-3xl font-black text-red-400">{formatReceiptNo(order.orderId)}</span>
          </p>
          {st === 'cash_due' && (
            <p className="mt-3 rounded-lg bg-zinc-800 p-3 text-sm text-zinc-300">
              お支払いは当日会場受付にて <span className="font-bold text-white">{yen(order.amountTotal)}</span>(現金)をお願いします。
            </p>
          )}
          {st === 'paid' && (
            <p className="mt-3 rounded-lg bg-zinc-800 p-3 text-sm text-zinc-300">
              お支払い済み: <span className="font-bold text-white">{yen(order.amountTotal)}</span>(カード決済)
            </p>
          )}
        </>
      ) : st === 'pending' ? (
        <>
          <h1 className="text-2xl font-black text-white">決済待ちです</h1>
          <p className="mt-2 text-sm text-zinc-400">
            決済が完了するとエントリー確定になり、エントリーリストに掲載されます。
          </p>
          <CheckoutButton token={t!} amountTotal={order.amountTotal} />
          <p className="mt-2 text-center text-xs text-zinc-500">
            ※ 申込から30分以内に決済が完了しない場合、この申込は無効になります
          </p>
        </>
      ) : st === 'expired' ? (
        <>
          <h1 className="text-2xl font-black text-white">申込は無効になりました</h1>
          <p className="mt-4 text-zinc-400">
            30分以内に決済が完了しなかったため、枠を解放しました。お手数ですがもう一度エントリーしてください。
          </p>
          <Link href="/bf6/entry" className="mt-6 block w-full rounded-xl bg-red-600 py-4 text-center text-lg font-black text-white">
            もう一度エントリーする
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-black text-white">この申込はキャンセルされています</h1>
          <p className="mt-4 text-zinc-400">ご不明な点は公式LINEからお問い合わせください。</p>
        </>
      )}

      <section className="mt-6 space-y-3">
        {entries.map((e, i) => (
          <div key={i} className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <p className="text-lg font-bold text-white">
              {e.dancerName} <span className="text-sm font-normal text-zinc-400">({e.dancerKana})</span>
            </p>
            <p className="text-sm text-zinc-400">{e.performerName} / {bf6GradeLabel(e.grade)}</p>
            <p className="mt-1 text-white">{e.divisions.map(bf6DivisionLabel).join('・')} — {yen(e.unitAmount)}</p>
          </div>
        ))}
        {(adult || child) && (
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-zinc-500">観覧チケット</p>
            {adult && <p className="text-white">大人 × {adult.qty} — {yen(adult.qty * adult.unitAmount)}</p>}
            {child && <p className="text-white">小学生 × {child.qty} — {yen(child.qty * child.unitAmount)}</p>}
          </div>
        )}
      </section>

      {(st === 'paid' || st === 'cash_due') && (
        <p className="mt-6 text-center text-sm text-zinc-400">
          このページのURLが申込内容の確認ページです。ブックマークをおすすめします。<br />
          変更・キャンセルは公式LINEからご連絡ください。
        </p>
      )}

      <p className="mt-6 text-center text-sm">
        <Link href="/bf6/entries" className="text-red-400 underline">エントリーリストを見る</Link>
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-8">{children}</div>
    </div>
  );
}
