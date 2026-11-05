// ⚠️ 公開ページ(認証なし)。理由: 特商法に基づく表記は決済導線から誰でも参照できる必要がある(/bf7/legal と同じ扱い)。
import type { Metadata } from 'next';
import { MOCCHIN_LESSON_DAYS } from '@/lib/mocchinEntry';
import { Panel, Shell } from '../ui';

export const metadata: Metadata = { title: 'BW6 スペシャルナンバー by MOCCHIN 特商法表記' };

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/15 py-2 last:border-0">
      <dt className="text-xs font-black text-[#19F2D6]">{label}</dt>
      <dd className="text-sm font-bold">{children}</dd>
    </div>
  );
}

export default function MocchinLegalPage() {
  return (
    <Shell>
      <h1 className="text-2xl font-black">特定商取引法に基づく表記</h1>
      <Panel>
        <dl>
          <Row label="販売事業者">BOOM DANCE SCHOOL(ブーム ダンス スクール)</Row>
          <Row label="運営責任者">木村 慎大郎</Row>
          <Row label="所在地・電話番号">ご請求をいただいた場合、遅滞なく開示いたします。下記メールアドレスまでご連絡ください。</Row>
          <Row label="連絡先メールアドレス">boom.sendai@gmail.com</Row>
          <Row label="販売価格">申込ページに表示する金額(消費税込)</Row>
          <Row label="商品代金以外の必要料金">インターネット接続にかかる通信料。銀行振込の場合は振込手数料。カードの決済手数料はかかりません</Row>
          <Row label="支払方法">銀行振込、またはクレジットカード等によるオンライン決済(Stripe)</Row>
          <Row label="支払時期">お申込み時に選んだお支払い方法の期限まで(申込後の画面とメールでご案内します)</Row>
          <Row label="提供時期">2027年1月〜4月の全{MOCCHIN_LESSON_DAYS}日の振り入れと、2027年4月11日の本番</Row>
        </dl>
      </Panel>
      <Panel title="キャンセル・返金">
        <ul className="space-y-2 text-sm font-bold">
          <li>お客様のご都合によるキャンセル・返金はお受けできません。お休みしたり途中でやめたりした場合も、返金・減額はありません</li>
          <li>主催者の都合で中止した場合は、お支払いいただいた代金を全額返金します</li>
        </ul>
      </Panel>
    </Shell>
  );
}
