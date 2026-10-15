// ⚠️ 公開ページ(認証なし)。理由: クリスマスパーティー2026のチケット予約フォーム(外部の子も参加可)。
import Link from 'next/link';
import { formatJstLabel, ticketOpenAtOf } from '@/lib/party';
import { getXmasContext } from '../actions';
import { Notice, PreviewBanner, XmasShell } from '../ui';
import TicketForm from './TicketForm';

export const dynamic = 'force-dynamic';

export default async function XmasTicketPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  const ctx = await getXmasContext(preview);
  const s = ctx.settings;
  const cardOpen = ctx.ticketCard === 'open';
  const cashOpen = ctx.ticketCash === 'open';

  return (
    <XmasShell>
      {ctx.preview && <PreviewBanner />}
      <h1 className="text-center text-2xl font-black">チケット予約(前売)</h1>
      {cardOpen || cashOpen ? (
        <TicketForm
          presalePrice={s.presalePrice}
          cardOpen={cardOpen}
          cashOpen={cashOpen}
          cardDeadline={formatJstLabel(s.ticketCardDeadline)}
          cashDeadline={formatJstLabel(s.ticketCashDeadline)}
        />
      ) : (
        <Notice>
          {ctx.ticketCash === 'before'
            ? ticketOpenAtOf(s)
              ? `受付は ${formatJstLabel(ticketOpenAtOf(s))} に始まります。`
              : '受付開始は近日お知らせします。'
            : '前売の受付は終了しました。当日券は会場でお求めください。'}
        </Notice>
      )}
      <Link href="/xmas" className="mt-8 block text-center text-sm font-black underline">
        ← パーティーの案内に戻る
      </Link>
    </XmasShell>
  );
}
