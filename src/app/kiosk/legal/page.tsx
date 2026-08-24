// ⚠️ 公開ページ(認証なし)。理由: 特商法に基づく表記は決済導線(/kiosk)から
// 誰でも参照できる必要がある。物販(現物・その場渡し)向けの記載。
export const metadata = { title: '特定商取引法に基づく表記 - BOOM GOODS' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-sand-200 py-3 last:border-b-0 md:grid-cols-[180px_1fr] md:gap-4">
      <dt className="text-sm font-bold text-navy-500">{label}</dt>
      <dd className="text-sm text-navy-900">{children}</dd>
    </div>
  );
}

export default function KioskLegalPage() {
  return (
    <div className="mx-auto max-w-2xl bg-[#F4EDE5] p-6 text-navy-900">
      <h1 className="text-2xl font-extrabold">特定商取引法に基づく表記</h1>
      <p className="mt-1 text-sm text-navy-500">BOOM GOODS(イベント会場グッズ販売)</p>
      <dl className="mt-6 rounded-2xl bg-white p-5 shadow">
        <Row label="販売事業者">BOOM DANCE SCHOOL(ブーム ダンス スクール)</Row>
        <Row label="運営責任者">木村 慎大郎</Row>
        <Row label="所在地">
          ご請求をいただいた場合、遅滞なく開示いたします。下記メールアドレスまでご連絡ください。
        </Row>
        <Row label="電話番号">
          ご請求をいただいた場合、遅滞なく開示いたします。下記メールアドレスまでご連絡ください。
        </Row>
        <Row label="連絡先メールアドレス">boom.sendai@gmail.com</Row>
        <Row label="販売価格">各商品に表示する金額(消費税込)</Row>
        <Row label="商品代金以外の必要料金">
          なし(インターネット接続にかかる通信料はお客様負担。決済手数料はかかりません)
        </Row>
        <Row label="支払方法">
          オンライン決済(Stripe: クレジットカード・PayPay・Apple Pay・Google Pay等)、または会場での現金支払い
        </Row>
        <Row label="支払時期">ご購入時</Row>
        <Row label="商品の引渡時期">お支払い確認後、その場でお渡しします(会場での対面販売)</Row>
        <Row label="返品・交換">
          商品の性質上、お客様都合による返品・返金はお受けできません。
          不良品は交換対応いたしますので、会場スタッフまたは上記メールアドレスまでご連絡ください。
        </Row>
      </dl>
      <p className="mt-6 text-center text-sm">
        <a href="/kiosk" className="font-bold text-brand-700 underline">
          レジ画面に戻る
        </a>
      </p>
    </div>
  );
}
