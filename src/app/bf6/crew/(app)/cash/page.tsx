// クルー: 当日現金の集金。
//
// 事前カード決済をしなかった人は会場で現金を払う。集金は人力なので、
// 係の人が「誰から・いくら受け取ったか」をその場で残せるようにする(TARO 2026-09-10)。
// お金は注文単位。きょうだいで1注文なら1回払いで全員ぶん済む。
//
// ⚠️ 受付で「エントリー代+観覧代」を全額まとめて受け取る(TARO決定 2026-09-16)。
//    14:30の開場が一日で一番混むため、そこに現金のやり取りを持ち込まない。
//    全額もらっておけば、入場受付では支払い済みと出てリストバンドを渡すだけになる。
import { listBf6CashOrders } from '@/lib/bf6CashDb';
import CrewHeader from '../CrewHeader';
import CashList from './CashList';

export const dynamic = 'force-dynamic';

export default async function CrewCashPage() {
  const orders = await listBf6CashOrders();
  return (
    <div>
      <CrewHeader
        title="当日現金の集金"
        description="観覧チケット代も含めて全額まとめて受け取る"
      />
      <div className="mx-auto max-w-2xl p-4">
        <CashList orders={orders} />
      </div>
    </div>
  );
}
