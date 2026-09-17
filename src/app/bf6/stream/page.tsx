// ⚠️ 公開API/ページ(認証なし)。理由: BF6オンライン配信チケットの販売LP(一般向け)。
//
// 販売していないときは案内を出さず、黙ってイベントページへ戻す
// (TARO 2026-09-17「しれっと消して、誰も見れないようにしてしまえばいい」)。
// 受付の開閉は /staff/bf6/settings の「オンライン配信の受付」で切り替える。
import { redirect } from 'next/navigation';
import { getBf6StreamConfig } from '@/lib/bf6StreamDb';
import StreamClient from './StreamClient';

export const dynamic = 'force-dynamic';

export default async function Bf6StreamPage() {
  const cfg = await getBf6StreamConfig();
  if (!cfg.open) redirect('/bf6');
  return <StreamClient />;
}
