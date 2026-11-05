// ⚠️ 公開ページ(認証なし)。理由: HIRO ワークショップの完了画面。edit_token 完全一致の
// 自分の申込1件のみ表示する(列挙不可・トークンなしでは何も出さない)。会員データとの照合結果は出さない。
import type { Metadata } from 'next';
import Link from 'next/link';
import { BF7_WORKSHOP } from '@/lib/bf7';
import { BF7_WS_BANK, bf7WsClassLines, bf7WsPayDeadline, bf7WsTransferPrefix, formatBf7WsDate, formatBf7WsNo, yenBf7Ws } from '@/lib/bf7Workshop';
import { loadBf7WsOrderByToken } from '@/lib/bf7WorkshopDb';
import { Bf7Card, Bf7Hero, Bf7Shell, btnPrimaryCls } from '../../ui';
import CheckoutButton from './CheckoutButton';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'HIRO WORKSHOP お申込み', robots: { index: false } };
export const viewport = { themeColor: '#0b1b36' };

export default async function Bf7WorkshopCompletePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const order = t ? await loadBf7WsOrderByToken(t) : null;

  if (!order) {
    return (
      <Bf7Shell>
        <Bf7Hero title="NOT FOUND" subtitle="申込が見つかりません" />
        <div className="px-4 py-6">
          <Bf7Card>
            <p className="text-sm text-neutral-300">URLが正しいかご確認ください。</p>
          </Bf7Card>
        </div>
      </Bf7Shell>
    );
  }

  const st = order.paymentStatus;
  const hero =
    st === 'paid'
      ? { title: 'COMPLETE', subtitle: 'お申込みありがとうございます!' }
      : st === 'transfer_due'
        ? { title: 'ONE MORE STEP', subtitle: 'お振込みをお願いします' }
      : st === 'pending'
        ? { title: 'ONE MORE STEP', subtitle: '決済待ちです' }
        : st === 'expired'
          ? { title: 'EXPIRED', subtitle: '申込は無効になりました' }
          : { title: 'CANCELED', subtitle: 'この申込は取り消されました' };

  return (
    <Bf7Shell>
      <Bf7Hero title={hero.title} subtitle={hero.subtitle} />
      <div className="space-y-5 px-4 py-6">
        {(st === 'paid' || st === 'transfer_due') && (
          <>
            <div className="rounded-2xl bg-black p-5 text-center ring-1 ring-neutral-800">
              <p className="text-xs font-bold tracking-widest text-neutral-400">受付番号</p>
              <p className="mt-1 text-4xl font-black italic text-white">{formatBf7WsNo(order.id)}</p>
            </div>
            {st === 'transfer_due' ? (
              <Bf7Card label="お振込み">
                <dl className="space-y-1 text-sm font-bold text-neutral-100">
                  <div>金額: <span className="text-lg font-black text-white">{yenBf7Ws(order.amountTotal)}</span></div>
                  <div>期限: {formatBf7WsDate(bf7WsPayDeadline(order.appliedOn))} まで</div>
                  <div className="pt-2">
                    {BF7_WS_BANK.bank} {BF7_WS_BANK.branch}
                    <br />
                    {BF7_WS_BANK.type} {BF7_WS_BANK.number}
                    <br />
                    口座名義: {BF7_WS_BANK.holder}
                  </div>
                </dl>
                <p className="mt-3 rounded-lg bg-sky-500/15 p-3 text-sm font-black text-white">
                  振込名義の前に、受付番号「{bf7WsTransferPrefix(order.id)}」を付けてください
                  <span className="block font-bold text-neutral-200">例: {bf7WsTransferPrefix(order.id)} ヤマダハナコ</span>
                </p>
                <p className="mt-2 text-xs leading-relaxed text-neutral-400">
                  振込手数料はご負担をお願いします。期限までにご入金を確認できない場合、お申込みを取り消すことがあります。
                </p>
              </Bf7Card>
            ) : (
              <p className="rounded-xl border-2 border-sky-600 bg-sky-950/40 p-4 text-sm font-bold text-sky-300">
                お支払い済み: {yenBf7Ws(order.amountTotal)}
              </p>
            )}
          </>
        )}

        {st === 'pending' && (
          <>
            <p className="rounded-xl border-2 border-sky-600 bg-sky-950/40 p-4 text-sm font-bold text-sky-300">決済が完了すると、お申込みが確定します。</p>
            <CheckoutButton token={t!} amountTotal={order.amountTotal} />
            <p className="text-center text-xs text-neutral-400">※ 申込から30分以内に決済が完了しない場合、この申込は無効になります</p>
          </>
        )}

        {st === 'expired' && (
          <>
            <Bf7Card>
              <p className="text-sm text-neutral-300">30分以内に決済が完了しなかったため、枠を解放しました。お手数ですがもう一度お申し込みください。</p>
            </Bf7Card>
            <Link href="/bf7/workshop" className={`block w-full rounded-2xl py-4 text-center text-lg font-black ${btnPrimaryCls}`}>
              もう一度申し込む
            </Link>
          </>
        )}

        {st === 'canceled' && (
          <Bf7Card>
            <p className="text-sm text-neutral-300">ご不明な点は公式LINEからお問い合わせください。</p>
          </Bf7Card>
        )}

        {st !== 'expired' && st !== 'canceled' && (
          <Bf7Card label="お申込み内容">
            <p className="text-sm font-bold text-white">{order.name} 様</p>
            <ul className="mt-2 space-y-1 text-sm text-neutral-200">
              {bf7WsClassLines(order.first, order.second).map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-3 text-sm font-bold text-neutral-100">2027年1月31日(日)</p>
            <p className="text-sm text-neutral-200">{BF7_WORKSHOP.venue}</p>
            <p className="text-xs text-neutral-400">{BF7_WORKSHOP.address}</p>
            {order.isMember && (
              <p className="mt-3 text-xs text-neutral-400">※会員料金は会員ご本人のみです。会員でないことが分かった場合は、差額をお支払いいただきます。</p>
            )}
          </Bf7Card>
        )}

        {(st === 'paid' || st === 'transfer_due') && (
          <p className="text-center text-xs text-neutral-400">確認のメールをお送りしています。届かない場合は、この画面をスクリーンショットで保存してください。</p>
        )}

        <p className="text-center text-sm">
          <Link href="/bf7" className="font-bold text-sky-400 underline">
            イベントページに戻る
          </Link>
        </p>
      </div>
    </Bf7Shell>
  );
}
