// スタッフ: BF6設定(定員・料金・受付ON/OFF)。/staff/* 配下のためproxy認証で保護(規約4.5)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getBf6Settings } from '@/lib/bf6Db';
import SettingsForm from './SettingsForm';

export const dynamic = 'force-dynamic';

export default async function StaffBf6SettingsPage() {
  const s = await getBf6Settings();
  return (
    <div>
      <StaffPageHeader
        title="BF6設定"
        description="定員・料金・受付ON/OFF・締切(保存すると即、公開ページに反映されます)"
        backHref="/staff/bf6"
        backLabel="BF6ダッシュボード"
      />
      <div className="mx-auto max-w-3xl p-4">
        <SettingsForm
          initial={{
            entryOpen: s.entryOpen,
            ticketOpen: s.ticketOpen,
            entryDeadline: s.entryDeadline,
            ticketDeadline: s.ticketDeadline,
            hallCapacity: s.hallCapacity,
            capacity: s.capacity,
            pricing: s.pricing,
          }}
        />
      </div>
    </div>
  );
}
