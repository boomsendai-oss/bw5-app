// クルー: 観覧のお客さんの入場受付と当日券。
//
// 14:30開場、15分で入れる(TARO 2026-09-11)。名前を聞いて探す → 支払い済みならリストバンドを渡して記録。
// 当日現金でまだなら、ここで受け取ってから渡す。受け取りは集金画面・受付と共有される。
// 予約なしで来たお客さんには、同じ画面で当日券を売って数える。
import { listBf6GateOrders, listBf6WalkinSales } from '@/lib/bf6GateDb';
import { getBf6Settings } from '@/lib/bf6Db';
import { calcTicketUnitPrice } from '@/lib/bf6';
import CrewHeader from '../CrewHeader';
import GateList from './GateList';

export const dynamic = 'force-dynamic';

export default async function CrewGatePage() {
  const [orders, sales, settings] = await Promise.all([
    listBf6GateOrders(),
    listBf6WalkinSales(),
    getBf6Settings(),
  ]);
  const prices = {
    adult: calcTicketUnitPrice('ticket_adult', 'onsite', settings.pricing),
    child: calcTicketUnitPrice('ticket_child', 'onsite', settings.pricing),
  };
  return (
    <div>
      <CrewHeader title="入場受付(観覧)" description="名前で探して、リストバンドを渡したら記録。予約なしの方は当日券" />
      <div className="mx-auto max-w-2xl p-4">
        <GateList orders={orders} walkinSales={sales} prices={prices} />
      </div>
    </div>
  );
}
