export const metadata = {
  title: 'プライバシーポリシー | BOOM',
  description: 'ストリートダンススクールBOOMのプライバシーポリシー / Privacy Policy of BOOM street dance school',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-10 text-[15px] leading-relaxed text-neutral-800">
      <h1 className="text-2xl font-bold">プライバシーポリシー / Privacy Policy</h1>
      <p className="mt-2 text-sm text-neutral-500">最終更新 / Last updated: 2026-08-06</p>

      <section className="mt-8">
        <h2 className="text-lg font-bold">事業者 / Operator</h2>
        <p className="mt-2">
          ストリートダンススクール BOOM（宮城県仙台市・代表 木村 慎大郎）
          <br />
          BOOM street dance school (Sendai, Miyagi, Japan)
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">収集する情報 / Information we collect</h2>
        <p className="mt-2">
          本サイトおよび関連アプリ（以下「本サービス」）は、レッスン予約・イベント申込・お問い合わせ対応のために、氏名・連絡先など必要最小限の情報をお預かりします。
        </p>
        <p className="mt-2">
          Our website and related applications collect only the minimum information
          necessary (such as name and contact details) for lesson bookings, event
          entries, and inquiries.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">SNS連携 / Social media integrations</h2>
        <p className="mt-2">
          本サービスは、BOOMが自ら運営する公式SNSアカウント（Instagram・YouTube・X・Threads・Facebook・TikTok）へ、BOOM自身が制作したレッスン動画等のコンテンツを投稿するためにSNS各社のAPIを利用します。この連携で扱うのはBOOM自身のアカウントの認証情報のみであり、
          <b>SNSの一般ユーザーの個人情報を収集・保存することはありません</b>。
        </p>
        <p className="mt-2">
          We use social platform APIs (including the TikTok Content Posting API)
          solely to publish BOOM&apos;s own content to BOOM&apos;s own official
          accounts. We store only the authentication tokens of BOOM&apos;s own
          accounts and <b>do not collect or store personal data of other platform
          users</b>.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">第三者提供 / Sharing</h2>
        <p className="mt-2">
          法令に基づく場合を除き、お預かりした個人情報を第三者に提供することはありません。
        </p>
        <p className="mt-2">
          We do not share personal information with third parties except as
          required by law.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">お問い合わせ / Contact</h2>
        <p className="mt-2">
          boom.sendai@gmail.com
        </p>
      </section>
    </main>
  );
}
