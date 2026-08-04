// ⚠️ 公開ページ(認証なし)。理由: 特商法に基づく表記・キャンセルポリシーは
// 決済導線から誰でも参照できる必要がある。文面は規約草案の確定後に流し込む。
import Link from 'next/link';
import { Bf6Card, Bf6Hero } from '../ui';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 特商法表記・キャンセルポリシー",
};

export default function Bf6LegalPage() {
  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-lg pb-12">
        <Bf6Hero title="LEGAL" subtitle="特定商取引法に基づく表記・キャンセルポリシー" />
        <div className="px-4 py-6">
          <Bf6Card>
            <p className="text-neutral-700">準備中です。エントリー受付開始までに掲載します。</p>
          </Bf6Card>
          <p className="mt-6 text-center text-sm">
            <Link href="/bf6" className="font-bold text-red-600 underline">イベントページに戻る</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
