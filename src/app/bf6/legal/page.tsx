// ⚠️ 公開ページ(認証なし)。理由: 特商法に基づく表記・キャンセルポリシーは
// 決済導線から誰でも参照できる必要がある。文面は規約草案の確定後に流し込む。
import Link from 'next/link';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 特商法表記・キャンセルポリシー",
};

export default function Bf6LegalPage() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-2xl font-black text-white">特定商取引法に基づく表記・キャンセルポリシー</h1>
        <p className="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-4 text-sm text-zinc-400">
          準備中です。エントリー受付開始までに掲載します。
        </p>
        <p className="mt-6 text-center text-sm">
          <Link href="/bf6" className="text-red-400 underline">イベントページに戻る</Link>
        </p>
      </div>
    </div>
  );
}
