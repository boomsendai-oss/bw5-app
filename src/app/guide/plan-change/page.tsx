import type { Metadata } from 'next';
import {
  getPlanChangeTiming,
  formatMonthLabel,
  formatDayLabel,
} from '@/lib/planChangeDeadline';
import { GuideShell, GuideCallout, PORTAL_URL } from '../_components/GuideShell';
import { GuideStep, GuideSteps } from '../_components/GuideStep';
// 実画面キャプチャ(2026-08-08撮影・501px)。氏名/メールは撮影前にCSSでぼかしてある
import capHome from '../_captures/plan-2-home.png';
import capMypage from '../_captures/plan-3-mypage.png';
import capKeiyaku from '../_captures/plan-4-keiyaku.png';
import capStartMonth from '../_captures/plan-5-startmonth.png';

// 締切の残り日数を今日の日付から出すため、リクエストごとに描画する。
// 静的化するとビルド日の「あと◯日」が焼き付いて嘘になる。
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'プランを変えたい | BOOM 使い方ガイド',
  description:
    'BOOMポータルでのプラン変更の手順。締切は毎月10日で、10日までの手続きなら翌月から、11日以降は翌々月からの適用になります。',
};

export default function PlanChangePage() {
  const t = getPlanChangeTiming();
  const baseYm = t.today.slice(0, 7);

  return (
    <GuideShell
      title="プランを変えたい"
      lead="回数を増やす・減らす、チケット会員に切り替えるなどの手続きです。ご自身でBOOMポータルからできます。"
      helpNote="画面が案内と違う・変更したいプランが出てこない時は、公式LINEでご連絡ください。締切前ならスタッフ側で対応できます。"
    >
      {/* ① 今日の日付から結論を出す。最頻質問「いつまでに変更すればいい」への直接の答え */}
      <section className="rounded-xl border border-brand-200 bg-white p-5 shadow-sm">
        <p className="text-[13px] font-semibold tracking-wide text-brand-700">
          いつまでに手続きすればいい？
        </p>
        {t.inTime ? (
          <>
            {/* 締切は「日付」を主役にする。カウントダウンは急ぎ具合を伝えるだけの別文にし、
                「あと2日(8月10日まで)に手続きすれば」のように括弧で文を分断しない(TARO指摘 2026-08-08) */}
            <p className="mt-2 text-[17px] font-bold leading-relaxed text-navy-800">
              今日は{formatDayLabel(t.today)}。
              {t.daysLeft === 0 ? (
                <>
                  <span className="text-brand-600">今日が締切</span>です。
                </>
              ) : (
                <>
                  締切まで<span className="text-brand-600">あと{t.daysLeft}日</span>です。
                </>
              )}
            </p>
            <p className="mt-1 text-[17px] font-bold leading-relaxed text-navy-800">
              <span className="inline-block whitespace-nowrap rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">
                {/* 締切当日に「8月10日までに」と繰り返すと冗長なので「今日中」に言い換える */}
                {t.daysLeft === 0 ? '今日中' : `${formatDayLabel(t.deadline)}まで`}
              </span>
              に手続きすれば、
              <span className="inline-block whitespace-nowrap rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">
                {formatMonthLabel(t.effectiveMonth, baseYm)}分
              </span>
              から新しいプランになります。
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
              {formatDayLabel(t.deadline)}を過ぎると、
              {formatMonthLabel(t.missedMonth, baseYm)}分からの適用になります。
            </p>
          </>
        ) : (
          <>
            <p className="mt-2 text-[17px] font-bold leading-relaxed text-navy-800">
              今日は{formatDayLabel(t.today)}。今月の締切（{formatDayLabel(t.deadline)}）は過ぎています。
            </p>
            <p className="mt-1 text-[17px] font-bold leading-relaxed text-navy-800">
              いま手続きすると
              <span className="inline-block whitespace-nowrap rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">
                {formatMonthLabel(t.effectiveMonth, baseYm)}分
              </span>
              から新しいプランになります。
            </p>
            <p className="mt-3 text-[13px] leading-relaxed text-neutral-500">
              いま手続きしても、締切まで待ってから手続きしても、適用月は同じです。忘れないうちに済ませてしまうのがおすすめです。
            </p>
          </>
        )}
      </section>

      <div className="mt-4">
        <GuideCallout>
          <p className="font-semibold">なぜ10日が締切なの？</p>
          <p className="mt-1">
            月会費が<b>前払い</b>だからです。翌月分のお支払いを月内に頂くため、その前にプランを確定させる必要があります。
          </p>
        </GuideCallout>
      </div>

      {/* ② 手順 */}
      <h2 className="mb-5 mt-9 text-lg font-bold text-navy-800">手順</h2>
      <GuideSteps>
        <GuideStep
          n={1}
          title="BOOMポータルにログインする"
          body={
            <>
              <a className="text-brand-700 underline" href={PORTAL_URL}>
                boom.hacomono.jp
              </a>
              を開いて、登録したメールアドレスとパスワードでログインします。ログインできない時は
              <a className="text-brand-700 underline" href="/guide/login">
                こちら
              </a>
              。
            </>
          }
        />
        <GuideStep
          n={2}
          title="画面の下の「マイページ」を押す"
          // 実機確認(2026-08-08): 下部バーはログイン状態で変わる。
          // 未ログイン=4つ(ホーム/予約/予定管理/マイページ)、ログイン後=5つ(中央に会員証が増える)。
          // 会員が見るのはログイン後なので純正マニュアルの「5つ」は誤りではないが、
          // 状態で変わる数を書くと迷わせるため、位置だけで案内する
          body="画面のいちばん下のバー、その右端にあります。"
          image={capHome}
          imageAlt="ログイン後のホーム画面。画面下のバーの右端に「マイページ」がある"
          hotspot={{ left: 84, top: 92.5, width: 12, height: 7 }}
        />
        <GuideStep
          n={3}
          title="「契約管理」を押す"
          body="マイページの中ほど、右側にあります。今契約しているプランがここに出ます。"
          image={capMypage}
          imageAlt="マイページ。「チケットの購入」の右に「契約管理」のボタンがある"
          hotspot={{ left: 50.5, top: 34.8, width: 46.5, height: 11.8 }}
        />
        <GuideStep
          n={4}
          title="「プランを変更」を押す"
          body={
            <>
              契約中のプランの下にあります。<b>すぐ下が「退会」</b>なので、押し間違いにご注意ください。
            </>
          }
          image={capKeiyaku}
          imageAlt="契約管理の画面。「プランを変更」の行があり、その下に「退会」がある"
          hotspot={{ left: 1, top: 49, width: 98, height: 7 }}
        />
        <GuideStep
          n={5}
          title="変更を始める月を選ぶ"
          body={
            <>
              <b>ここが10日締切の正体です。</b>選べる月がこの欄に出てきます。10日までに手続きしていれば翌月が選べます。希望の月になっているか必ず確認してください。
            </>
          }
          image={capStartMonth}
          imageAlt="プラン変更手続きの2/7画面。「プランを変更する開始年月を選択してください」と変更開始年月日の選択欄"
          hotspot={{ left: 0.5, top: 19.5, width: 99, height: 15.5 }}
        />
        <GuideStep
          n={6}
          title="新しいプランを選んで「次へ」"
          body={
            <>
              同じ画面の下に、月額料金つきでプランが並びます。
              <b>最初はいちばん上の「受け放題」が選ばれた状態</b>になっているので、そのまま進めず、<b>必ず自分の希望するプランを選び直してください。</b>
            </>
          }
        />
        <GuideStep
          n={7}
          title="あとは画面の案内どおりに進める"
          body={
            <>
              手続きは全部で7ステップあり、画面の上に「◯/7」と出ます。最後まで進めて完了画面が出れば終わりです。ホームの契約プラン欄でも確認できます。
            </>
          }
        />
      </GuideSteps>

      {/* ③ 間違えやすい前提 */}
      <h2 className="mb-3 mt-10 text-lg font-bold text-navy-800">よくある勘違い</h2>
      <div className="space-y-3">
        <GuideCallout tone="warn">
          <p className="font-semibold">今月分から変えることはできません</p>
          <p className="mt-1">
            月会費は前払いのため、いちばん早くて翌月分からの適用です。
          </p>
        </GuideCallout>
        <GuideCallout tone="warn">
          <p className="font-semibold">今月の残り回数は翌月に繰り越せません</p>
          <p className="mt-1">
            月謝プランの未消化分はその月で消滅します。チケットにもなりません。
          </p>
        </GuideCallout>
        <GuideCallout tone="warn">
          <p className="font-semibold">休会は別の手続きです</p>
          <p className="mt-1">
            しばらくお休みしたい場合はプラン変更ではなく休会になります（締切は同じ毎月10日）。手続き方法は公式LINEでスタッフにご相談ください。
          </p>
        </GuideCallout>
      </div>
    </GuideShell>
  );
}
