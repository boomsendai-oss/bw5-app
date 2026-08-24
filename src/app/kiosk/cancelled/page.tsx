// お客さんのスマホ側のキャンセルページ(Stripe Checkoutのcancel_url)。
export const metadata = { title: 'お支払いキャンセル - BOOM GOODS' };

export default function KioskCancelledPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 bg-[#F4EDE5] p-8 text-center text-navy-900">
      <h1 className="text-3xl font-extrabold">お支払いはされていません</h1>
      <p className="text-xl leading-relaxed">
        もう一度お支払いする場合は、
        <br />
        レジのiPadのQRコードを読み直してください。
      </p>
      <p className="mt-4 text-sm text-navy-500">このページは閉じて大丈夫です</p>
    </div>
  );
}
