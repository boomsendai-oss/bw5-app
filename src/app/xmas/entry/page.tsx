// ⚠️ 公開ページ(認証なし)。理由: クリスマスパーティー2026のショーケース出演エントリー
// (BOOMの生徒以外の友達もメンバーに入れる)。表示するのは残りチーム数などの公開情報のみ。
import Link from 'next/link';
import { XMAS_EVENT_INFO, formatJstLabel } from '@/lib/party';
import { getXmasContext } from '../actions';
import { Notice, XmasShell } from '../ui';
import EntryForm from './EntryForm';

export const dynamic = 'force-dynamic';

export default async function XmasEntryPage() {
  const ctx = await getXmasContext();
  const s = ctx.settings;

  const closedMsg =
    ctx.entry === 'before'
      ? s.openAt
        ? `エントリーは ${formatJstLabel(s.openAt)} に始まります。`
        : 'エントリー開始は近日お知らせします。'
      : ctx.entry === 'full'
        ? '定員に達したため、エントリーの受付を終了しました。'
        : ctx.entry === 'suspended'
          ? '現在エントリーの受付を停止しています。'
          : 'エントリーの受付は終了しました。';

  return (
    <XmasShell>
      <h1 className="text-center text-2xl font-black">ショーケース出演エントリー</h1>
      <p className="mt-2 text-center text-sm font-bold">
        2人以上のチーム・{XMAS_EVENT_INFO.showTimeLimit}・先着順・カード払いのみ
      </p>
      {ctx.entry === 'open' ? (
        <EntryForm
          entryUnit={ctx.entryUnit}
          performerFee={s.performerFee}
          presalePrice={s.presalePrice}
          teamsLeft={ctx.teamsLeft}
          entryDeadline={formatJstLabel(s.entryDeadline)}
          audioDeadline={formatJstLabel(s.audioDeadline)}
        />
      ) : (
        <Notice>{closedMsg}</Notice>
      )}
      <Link href="/xmas" className="mt-8 block text-center text-sm font-black underline">
        ← パーティーの案内に戻る
      </Link>
    </XmasShell>
  );
}
