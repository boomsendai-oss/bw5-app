// ⚠️ 公開ページ(認証なし)。理由: ショーケース出演チーム(外部の子を含む)が音源を提出するため。
// チームはエントリー時のメールアドレスかチーム名で探す(actions.findXmasEntryForAudio)。画面に出すのは
// チーム名と提出状況だけ。提出・差し替えのたびに登録メールアドレスへ通知が届く(なりすまし対策)。
import Link from 'next/link';
import { PARTY_EVENT_KEY, XMAS_EVENT_INFO, audioOpen, formatJstLabel } from '@/lib/party';
import { getPartySettings } from '@/lib/partyDb';
import { Notice, Panel, XmasShell } from '../ui';
import AudioLookup from './AudioLookup';
import { SHOWCASE_ORDER_NOTE } from '../content';

export const dynamic = 'force-dynamic';

export default async function XmasAudioPage() {
  const s = await getPartySettings(PARTY_EVENT_KEY);
  const open = audioOpen(s, new Date());
  return (
    <XmasShell>
      <h1 className="text-center text-2xl font-black">ショーケースに出演される方へ</h1>
      <p className="mt-2 text-center text-sm font-bold">音源の提出はこのページからできます</p>

      <Panel title="出演のご案内" tone="green">
        <ul className="space-y-1 text-sm font-bold">
          <li>・音源の提出締切:{formatJstLabel(s.audioDeadline)}</li>
          <li>・持ち時間は{XMAS_EVENT_INFO.showTimeLimit}</li>
          <li>・リハーサルの時間はありません</li>
          <li>・{SHOWCASE_ORDER_NOTE}</li>
        </ul>
      </Panel>

      <Panel title="音源の提出">
        {open ? (
          <AudioLookup />
        ) : (
          <Notice>音源の提出は締め切りました。差し替えが必要な場合は公式LINEへご連絡ください。</Notice>
        )}
      </Panel>

      <p className="mt-6 text-center text-xs font-bold text-neutral-700">
        チームが見つからないときは、BOOM 公式LINE までご連絡ください。
      </p>

      <Link href="/xmas" className="mt-8 block text-center text-sm font-black underline">
        ← パーティーの案内に戻る
      </Link>
    </XmasShell>
  );
}
