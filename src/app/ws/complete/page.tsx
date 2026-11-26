// ⚠️ 公開ページ(認証なし)。理由: 特設ワークショップの申込完了画面。edit_token 完全一致の
// 自分の申込1件だけを表示する(列挙不可・トークンなしでは何も出さない)。
import Link from 'next/link';
import { formatSpWsReceiptNo, spWsDateParts, spWsPayLabel, venueLabel, yen } from '@/lib/spWs';
import { getSpWsEvent, loadSpWsEntryByToken } from '@/lib/spWsDb';
import { WsCard, WsRow, WsShell, btnPrimaryCls } from '../ui';
import CheckoutButton from './CheckoutButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'お申し込みの確認 | BOOM DANCE SCHOOL', robots: { index: false } };

function Head({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <header className="bg-[#16142b] px-6 pb-10 pt-10 text-white">
      <p className="text-[10px] font-bold tracking-[0.3em] text-white/60">{eyebrow}</p>
      <h1 className="mt-3 text-3xl font-bold">{title}</h1>
      {sub && <p className="mt-2 text-sm text-white/80">{sub}</p>}
    </header>
  );
}

export default async function WsCompletePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const entry = t ? await loadSpWsEntryByToken(t) : null;
  const ev = entry ? await getSpWsEvent(entry.slug) : null;

  if (!entry || !ev) {
    return (
      <WsShell>
        <Head eyebrow="BOOM DANCE SCHOOL" title="お申し込みが見つかりません" />
        <div className="space-y-4 px-4 pt-6">
          <WsCard><p>URLが正しいかご確認ください。30分以内にカードのお支払いが済まなかったお申し込みは無効になります。</p></WsCard>
        </div>
      </WsShell>
    );
  }

  const st = entry.paymentStatus;
  const head =
    st === 'paid' ? { title: 'お申し込み完了', sub: 'お申し込みが確定しました。確認のメールをお送りしています。' }
      : st === 'onsite' ? { title: 'お申し込み完了', sub: 'お申し込みが確定しました。参加費は当日、会場でお支払いください。' }
        : st === 'pending' ? { title: 'あと少しです', sub: 'カードのお支払いが済むと、お申し込みが確定します。' }
          : st === 'expired' ? { title: '期限が切れました', sub: 'このお申し込みは無効になりました。' }
            : st === 'test' ? { title: 'テスト申込', sub: 'スタッフ確認用のテスト申込です(決済なし)。' }
              : { title: 'キャンセル済み', sub: 'このお申し込みはキャンセルされています。' };
  const d = spWsDateParts(ev.eventDate);

  return (
    <WsShell>
      <Head eyebrow={ev.title} title={head.title} sub={head.sub} />
      <div className="relative -mt-4 space-y-4 px-4">
        {(st === 'paid' || st === 'onsite' || st === 'test') && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-[0_10px_30px_rgba(22,20,43,0.12)]">
            <p className="text-xs font-bold tracking-[0.25em] text-[#6b6880]">受付番号</p>
            <p className="f-num mt-1 text-5xl font-bold">{formatSpWsReceiptNo(entry, ev.slug)}</p>
            <p className="mt-2 text-xs text-[#6b6880]">当日は受付で、受付番号かお名前をお伝えください</p>
            <p className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-bold ${st === 'onsite' ? 'bg-orange-50 text-[#c2410c]' : 'bg-[#fff4e6] text-[#00806f]'}`}>
              {yen(entry.amountTotal)}・{spWsPayLabel(entry)}
            </p>
          </div>
        )}
        {st === 'pending' && (
          <>
            <WsCard><p className="text-sm font-bold">カードのお支払いが済むと、お申し込みが確定します。</p></WsCard>
            <CheckoutButton token={t!} amountTotal={entry.amountTotal} />
            <p className="text-center text-xs text-[#6b6880]">※ お申し込みから30分以内にお支払いが済まない場合、このお申し込みは無効になります</p>
          </>
        )}
        {st === 'expired' && (
          <>
            <WsCard><p>30分以内にお支払いが済まなかったため、枠をお返ししました。お手数ですが、もう一度お申し込みください。</p></WsCard>
            <Link href={`/ws/${encodeURIComponent(ev.slug)}`} className={`block w-full rounded-full py-4 text-center text-lg font-bold ${btnPrimaryCls}`}>もう一度申し込む</Link>
          </>
        )}

        <WsCard title="お申し込み内容">
          <WsRow k="お名前">{entry.name} <span className="text-sm text-[#6b6880]">{entry.kana}</span></WsRow>
          <WsRow k="日時">{d.jp} {ev.startTime}〜{ev.endTime}</WsRow>
          <WsRow k="会場">
            <span className={ev.venue ? '' : 'font-bold text-[#c2410c]'}>{venueLabel(ev)}</span>
            {ev.venueAddress && <span className="block text-xs text-[#6b6880]">{ev.venueAddress}</span>}
          </WsRow>
          <WsRow k="参加費">{yen(entry.amountTotal)}<span className="block text-xs text-[#6b6880]">{spWsPayLabel(entry)}</span></WsRow>
        </WsCard>

        <p className="text-center text-xs leading-relaxed text-[#6b6880]">
          内容の変更・キャンセル・お問い合わせは{ev.contact || 'BOOM公式LINE'}までご連絡ください。
          <br />
          <Link href={`/ws/${encodeURIComponent(ev.slug)}`} className="underline">ワークショップのページへ</Link>
        </p>
      </div>
    </WsShell>
  );
}
