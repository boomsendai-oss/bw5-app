// ⚠️ 公開ページ(認証なし)。理由: 出場者が自分で操作する当日の受付端末のため、
// その場でログインさせるのが現実的でない(ガイドアクセスでロックして設置する)。
// 表示するのはダンサーネームのみで、本名・連絡先は返さない。
import { listKioskEntrants } from '@/lib/bf6KioskDb';
import { syncBf6Slots } from '@/lib/bf6DrawDb';
import CheckinClient from './CheckinClient';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 受付",
};

export default async function Bf6CheckinPage() {
  // エントリーは締切まで増えるので、開くたびにくじの本数を合わせる(減らさない)
  await syncBf6Slots();
  const entrants = await listKioskEntrants();
  return <CheckinClient entrants={entrants} />;
}
