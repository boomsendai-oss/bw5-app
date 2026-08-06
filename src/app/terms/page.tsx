export const metadata = {
  title: '利用規約 | BOOM',
  description: 'ストリートダンススクールBOOMの利用規約 / Terms of Service of BOOM street dance school',
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed text-neutral-800">
      <h1 className="text-2xl font-bold">利用規約 / Terms of Service</h1>
      <p className="mt-2 text-sm text-neutral-500">最終更新 / Last updated: 2026-08-06</p>

      <section className="mt-8">
        <h2 className="text-lg font-bold">第1条（本サービス）</h2>
        <p className="mt-2">
          本サイトおよび関連アプリ（以下「本サービス」）は、ストリートダンススクール
          BOOM（宮城県仙台市・代表 木村 慎大郎、以下「当スクール」）が運営する、レッスン情報の案内・予約・イベント申込・コンテンツ配信のためのサービスです。
        </p>
        <p className="mt-2">
          This website and related applications (the &quot;Service&quot;) are
          operated by BOOM street dance school (Sendai, Miyagi, Japan) to provide
          lesson information, bookings, event entries, and content publishing.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">第2条（コンテンツ）</h2>
        <p className="mt-2">
          本サービスを通じて配信される動画・画像・文章等のコンテンツはすべて当スクールが権利を有するか、権利者の許諾を得たものです。当スクールのSNS公式アカウントへの投稿は、当スクール自身のコンテンツの配信のみを目的とします。
        </p>
        <p className="mt-2">
          All content distributed through the Service (including videos posted to
          BOOM&apos;s own official social media accounts) is owned by BOOM or used
          with permission of the rights holders.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">第3条（禁止事項）</h2>
        <p className="mt-2">
          利用者は、本サービスの運営を妨げる行為、第三者の権利を侵害する行為、法令または公序良俗に反する行為をしてはなりません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">第4条（免責）</h2>
        <p className="mt-2">
          当スクールは、本サービスの内容を予告なく変更・停止することがあります。本サービスの利用により生じた損害について、当スクールに故意または重過失がある場合を除き、責任を負いません。
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">お問い合わせ / Contact</h2>
        <p className="mt-2">boom.sendai@gmail.com</p>
      </section>
    </main>
  );
}
