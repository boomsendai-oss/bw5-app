// クルー: 当日現金の集金。
//
// 事前カード決済をしなかった人は会場で現金を払う。集金は人力なので、
// 係の人が「誰から・いくら受け取ったか」をその場で残せるようにする(TARO 2026-09-10)。
// お金は注文単位。きょうだいで1注文なら1回払いで全員ぶん済む。
import { listBf6CashOrders } from '@/lib/bf6CashDb';
import CrewHeader from '../CrewHeader';
import CashList from './CashList';

export const dynamic = 'force-dynamic';

export default async function CrewCashPage() {
  const orders = await listBf6CashOrders();
  return (
    <div>
      <CrewHeader title="当日現金の集金" description="受け取ったらその場で記録する" />
      <div className="mx-auto max-w-2xl p-4">
        <CashList orders={orders} />
      </div>
    </div>
  );
}
