// スタッフ: クリパ2026の公開日時・締切・料金・上限。/staff/* 配下のためproxy認証で保護(規約4.5)。
// 本番中にデプロイせず、ここ(DBの値)で受付を切り替える。
import StaffPageHeader from '@/components/StaffPageHeader';
import { PARTY_EVENT_KEY } from '@/lib/party';
import { getPartySettings } from '@/lib/partyDb';
import SettingsForm from './SettingsForm';

import { redirect } from 'next/navigation';
import { isAuthorizedServer } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';

export default async function StaffXmasSettingsPage() {
  // proxyはcookieの有無しか見ないため、個人情報を出す前にセッションを本検証する(規約4.5)
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const s = await getPartySettings(PARTY_EVENT_KEY);
  return (
    <div>
      <StaffPageHeader
        title="クリパ2026 設定"
        description="公開日時・締切・料金・出演チームの上限。保存するとすぐ公開ページに反映されます"
        backHref="/staff/xmas"
        backLabel="クリパ2026"
      />
      <div className="mx-auto max-w-2xl p-4">
        <SettingsForm initial={s} />
      </div>
    </div>
  );
}
