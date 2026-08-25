// お客さんのスマホ側の決済完了ページ(Stripe Checkoutのsuccess_url)。
// 完了の正本はWebhook→iPad画面。ここは「iPadを見てね」の案内だけ。
import CloseButton from './CloseButton';

export const metadata = { title: 'お支払い完了 - BOOM GOODS' };

export default function KioskDonePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 bg-[#F4EDE5] p-8 text-center text-navy-900">
      <p className="text-6xl">🙌</p>
      <h1 className="text-3xl font-extrabold">お支払いありがとうございます！</h1>
      <p className="text-xl leading-relaxed">
        レジのiPadの画面が
        <br />
        「お支払い確認できました」に変わったら、
        <br />
        <span className="font-bold">商品をお持ちください。</span>
      </p>
      <div className="mt-4">
        <CloseButton />
      </div>
    </div>
  );
}
