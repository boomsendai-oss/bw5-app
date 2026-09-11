// クルー: 観覧のお客さんの入場受付。
//
// 14:30開場、15分で入れる(TARO 2026-09-11)。名前を聞いて探す → 支払い済みならリストバンドを渡して記録。
// 当日現金でまだなら、ここで受け取ってから渡す。受け取りは集金画面・受付と共有される。
import { listBf6GateOrders } from '@/lib/bf6GateDb';
import CrewHeader from '../CrewHeader';
import GateList from './GateList';

export const dynamic = 'force-dynamic';

export default async function CrewGatePage() {
  const orders = await listBf6GateOrders();
  return (
    <div>
      <CrewHeader title="入場受付(観覧)" description="名前で探して、リストバンドを渡したら記録" />
      <div className="mx-auto max-w-2xl p-4">
        <GateList orders={orders} />
      </div>
    </div>
  );
}
