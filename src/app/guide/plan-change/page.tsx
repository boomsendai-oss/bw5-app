import type { Metadata } from 'next';
import {
  getPlanChangeTiming,
  formatMonthLabel,
  formatDayLabel,
} from '@/lib/planChangeDeadline';
import { GuideShell, GuideCallout, PORTAL_URL } from '../_components/GuideShell';
import { GuideStep, GuideSteps } from '../_components/GuideStep';

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
            <p className="mt-2 text-[17px] font-bold leading-relaxed text-navy-800">
              今日は{formatDayLabel(t.today)}。
              {t.daysLeft === 0 ? (
                <>
                  <span className="text-brand-600">今日が締切</span>です。
                </>
              ) : (
                <>
                  あと<span className="text-brand-600">{t.daysLeft}日</span>（
                  {formatDayLabel(t.deadline)}まで）に手続きすれば
                </>
              )}
            </p>
            <p className="mt-1 text-[17px] font-bold leading-relaxed text-navy-800">
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">
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
              <span className="rounded bg-brand-50 px-1.5 py-0.5 text-brand-700">
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
          pendingCapture
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
          pendingCapture
          title="画面の下の「マイページ」を押す"
          body="画面のいちばん下に5つのボタンが並んでいます。その右端です。"
        />
        <GuideStep
          n={3}
          pendingCapture
          title="「契約管理」を押す"
          body="マイページの中にあります。今契約しているプランがここに出ます。"
        />
        <GuideStep n={4} pendingCapture title="「プラン変更」を押して、新しいプランを選ぶ" />
        <GuideStep
          n={5}
          pendingCapture
          title="確認画面で「いつから変わるか」を必ず見る"
          body={
            <>
              ここに表示される開始月が、実際に新しいプランになる月です。思っていた月と違う場合は、<b>確定せずに</b>公式LINEへご連絡ください。
            </>
          }
        />
        <GuideStep
          n={6}
          pendingCapture
          title="内容を確認して確定する"
          body="完了画面が出れば手続きは終わりです。ホームの契約プラン欄でも確認できます。"
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
