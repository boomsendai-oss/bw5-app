// ⚠️ 公開ページ(認証なし)。理由: 特商法に基づく表記・キャンセルポリシーは
// 決済導線から誰でも参照できる必要がある。
import Link from 'next/link';
import { Bf6Card, Bf6Hero, Bf6Shell } from '../ui';

export const metadata = {
  title: "BOOMER'S FIGHT!!! vol.6 特商法表記・キャンセルポリシー",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-neutral-800 py-3 last:border-b-0 md:grid-cols-[180px_1fr] md:gap-4">
      <dt className="text-sm font-bold text-neutral-400">{label}</dt>
      <dd className="text-sm text-neutral-200">{children}</dd>
    </div>
  );
}

export default function Bf6LegalPage() {
  return (
    <Bf6Shell>
      <div>
        <Bf6Hero title="LEGAL" subtitle="特定商取引法に基づく表記・キャンセルポリシー" />
        <div className="space-y-6 px-4 py-6">
          <Bf6Card label="特定商取引法に基づく表記">
            <dl>
              <Row label="販売事業者">BOOM DANCE SCHOOL(ブーム ダンス スクール)</Row>
              <Row label="運営責任者">木村 慎大郎</Row>
              <Row label="所在地">
                ご請求をいただいた場合、遅滞なく開示いたします。下記メールアドレスまでご連絡ください。
              </Row>
              <Row label="電話番号">
                ご請求をいただいた場合、遅滞なく開示いたします。下記メールアドレスまでご連絡ください。
              </Row>
              <Row label="連絡先メールアドレス">boom.sendai@gmail.com</Row>
              <Row label="販売価格">
                各申込ページ(バトルエントリー・観覧チケット・オンライン配信チケット)に表示する金額(消費税込)
              </Row>
              <Row label="商品代金以外の必要料金">
                インターネット接続にかかる通信料(お客様負担)。決済手数料はかかりません
              </Row>
              <Row label="支払方法">
                クレジットカード等によるオンライン決済(Stripe)、または当日会場での現金支払い
              </Row>
              <Row label="支払時期">
                オンライン決済: お申込み時 / 当日支払い: イベント当日の受付時
              </Row>
              <Row label="提供時期">
                バトルエントリー・観覧チケット: イベント当日(2026年9月26日)にサービスを提供します。
                オンライン配信チケット: 決済完了後、視聴キーをメールでお届けし、イベント当日のライブ配信および配信終了後1週間のアーカイブを視聴いただけます
              </Row>
              <Row label="動作環境(配信)">
                インターネット接続されたスマートフォン・PC等のブラウザ。視聴キー1つにつき同時視聴は1端末までです
              </Row>
            </dl>
          </Bf6Card>

          <Bf6Card label="キャンセル・返金ポリシー">
            <ul className="space-y-2 text-sm text-neutral-200">
              <li>
                ・お客様都合によるお申込み後のキャンセル・返金はお受けできません
                (サービスの性質上、クーリング・オフの適用はありません)
              </li>
              <li>
                ・主催者都合によりイベントを中止した場合は、お支払いいただいた代金を全額返金いたします
                (返金方法は決済手段に応じてご案内します)
              </li>
              <li>
                ・オンライン配信について、お客様の通信環境・視聴機器に起因する視聴不良は返金の対象外です。
                主催者側の配信トラブルにより配信の大部分を提供できなかった場合は、全額または一部を返金いたします
              </li>
              <li>
                ・エントリー内容の変更(部門・出場者情報など)は、公式LINEまたは上記メールアドレスまでご連絡ください
              </li>
            </ul>
          </Bf6Card>

          <p className="text-center text-sm">
            <Link href="/bf6" className="font-bold text-red-400 underline">イベントページに戻る</Link>
          </p>
        </div>
      </div>
    </Bf6Shell>
  );
}
