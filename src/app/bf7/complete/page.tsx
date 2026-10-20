// ⚠️ 公開ページ(認証なし)。理由: vol.7エントリー・チケットの完了画面。edit_token完全一致の
// 自分の申込1件のみ表示する(列挙不可・トークンなしでは何も出さない)。
import Link from 'next/link';
import { bf6DivisionLabel, bf6GradeLabel } from '@/lib/bf6';
import { formatBf7ReceiptNo } from '@/lib/bf7Entry';
import { loadBf7OrderByToken } from '@/lib/bf7EntryDb';
import { Bf7Card, Bf7Hero, Bf7Shell } from '../ui';
import CheckoutButton from './CheckoutButton';

export const dynamic = 'force-dynamic';

const yen = (n: number) => `¥${n.toLocaleString()}`;

export default async function Bf7CompletePage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string }>;
}) {
  const { t } = await searchParams;
  const order = t ? await loadBf7OrderByToken(t) : null;

  if (!order) {
    return (
      <Shell>
        <Bf7Hero title="NOT FOUND" subtitle="申込が見つかりません" />
        <div className="px-4 py-6">
          <Bf7Card>
            <p className="text-neutral-300">
              URLが正しいかご確認ください。30分以内に決済されなかった申込は無効になります。
            </p>
          </Bf7Card>
          <Link href="/bf7/entry" className="mt-5 block w-full rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(14,165,233,0.5)] py-4 text-center text-lg font-black">
            もう一度エントリーする
          </Link>
        </div>
      </Shell>
    );
  }

  const st = order.paymentStatus;
  const entries = order.items.filter((i) => i.itemType === 'entry');
  const adult = order.items.find((i) => i.itemType === 'ticket_adult');
  const child = order.items.find((i) => i.itemType === 'ticket_child');
  const isEntry = entries.length > 0;

  const hero =
    st === 'paid' || st === 'cash_due'
      ? { title: 'COMPLETE', subtitle: isEntry ? 'エントリー完了!' : 'ご予約ありがとうございます!' }
      : st === 'pending'
        ? { title: 'ONE MORE STEP', subtitle: '決済待ちです' }
        : st === 'expired'
          ? { title: 'EXPIRED', subtitle: '申込は無効になりました' }
          : { title: 'CANCELED', subtitle: 'この申込はキャンセルされています' };

  return (
    <Shell>
      <Bf7Hero title={hero.title} subtitle={hero.subtitle} />
      <div className="space-y-4 px-4 py-6">
        {(st === 'paid' || st === 'cash_due') && (
          <>
            <div className="rounded-2xl bg-black p-5 ring-1 ring-neutral-800 text-center">
              <p className="text-xs font-bold tracking-widest text-neutral-400">受付番号</p>
              <p className="mt-1 text-4xl font-black italic text-white">{formatBf7ReceiptNo(order.orderId)}</p>
            </div>
            {st === 'cash_due' ? (
              <p className="rounded-xl border-2 border-neutral-300 bg-neutral-900 p-4 text-sm font-bold text-neutral-200">
                お支払いは当日会場受付にて <span className="text-lg font-black">{yen(order.amountTotal)}</span>(現金)をお願いします。
              </p>
            ) : order.amountTotal === 0 ? (
              <p className="rounded-xl border-2 border-sky-600 bg-sky-950/40 p-4 text-sm font-bold text-sky-300">
                無料枠でのエントリーです。お支払いはありません。
              </p>
            ) : (
              <p className="rounded-xl border-2 border-sky-600 bg-sky-950/40 p-4 text-sm font-bold text-sky-300">
                お支払い済み: {yen(order.amountTotal)}(カード決済)
              </p>
            )}
          </>
        )}

        {st === 'pending' && (
          <>
            <p className="rounded-xl border-2 border-sky-600 bg-sky-950/40 p-4 text-sm font-bold text-sky-300">
              決済が完了するとエントリー確定になり、エントリーリストに掲載されます。
            </p>
            <CheckoutButton token={t!} amountTotal={order.amountTotal} />
            <p className="text-center text-xs text-neutral-400">
              ※ 申込から30分以内に決済が完了しない場合、この申込は無効になります
            </p>
          </>
        )}

        {st === 'expired' && (
          <>
            <Bf7Card>
              <p className="text-neutral-300">
                30分以内に決済が完了しなかったため、枠を解放しました。お手数ですがもう一度エントリーしてください。
              </p>
            </Bf7Card>
            <Link href="/bf7/entry" className="block w-full rounded-2xl bg-gradient-to-b from-sky-400 via-sky-500 to-blue-700 text-white ring-1 ring-blue-950 shadow-[inset_0_1px_0_rgba(255,255,255,0.35),inset_0_-2px_0_rgba(0,0,0,0.35),0_10px_25px_-5px_rgba(14,165,233,0.5)] py-4 text-center text-lg font-black">
              もう一度エントリーする
            </Link>
          </>
        )}

        {(st === 'canceled' || st === 'refunded') && (
          <Bf7Card>
            <p className="text-neutral-300">ご不明な点は公式LINEからお問い合わせください。</p>
          </Bf7Card>
        )}

        {entries.map((e, i) => (
          <Bf7Card key={i} label={`出場者${entries.length > 1 ? ` ${i + 1}` : ''}`}>
            <p className="text-xl font-black text-white">
              {e.dancerName} <span className="text-sm font-bold text-neutral-400">{e.dancerKana}</span>
            </p>
            <p className="mt-0.5 text-sm text-neutral-400">{e.performerName} / {bf6GradeLabel(e.grade)}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {e.divisions.map((d) => (
                <span key={d} className="rounded-full bg-sky-600 px-3 py-1 text-xs font-bold text-white">
                  {bf6DivisionLabel(d)}
                </span>
              ))}
            </div>
            <p className="mt-2 text-sm font-bold text-neutral-300">{yen(e.unitAmount)}</p>
          </Bf7Card>
        ))}

        {(adult || child) && (
          <Bf7Card label="観覧チケット">
            {adult && <p className="font-bold text-white">大人 × {adult.qty} — {yen(adult.qty * adult.unitAmount)}</p>}
            {child && <p className="font-bold text-white">小学生 × {child.qty} — {yen(child.qty * child.unitAmount)}</p>}
          </Bf7Card>
        )}

        {(st === 'paid' || st === 'cash_due') && (
          <p className="text-center text-xs text-neutral-400">
            このページのURLが申込内容の確認ページです。ブックマークをおすすめします。<br />
            変更・キャンセルは公式LINEからご連絡ください。
          </p>
        )}

        <p className="pt-2 text-center text-sm">
          <Link href="/bf7/entries" className="font-bold text-sky-400 underline">エントリーリストを見る</Link>
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <Bf7Shell>{children}</Bf7Shell>;
}
