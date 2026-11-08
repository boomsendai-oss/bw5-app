// ⚠️ 公開ページ(認証なし)。理由: 申込者本人の支払いページ。pay_token 完全一致の1件だけ表示する
// (列挙不可・トークンなしでは何も出さない)。名前や連絡先は出さず、申込番号と支払いの状況だけ出す。
import type { Metadata } from 'next';
import { todayJst } from '@/lib/dateJst';
import {
  LESSON_PLANS,
  LESSON_PLAN_LABEL,
  MOCCHIN_BANK,
  MOCCHIN_DEADLINE,
  MOCCHIN_PLAN_CHOOSE_BY,
  MOCCHIN_PLAN_INVITE_FROM,
  mocchinNeedsLessonPlan,
  formatJpDate,
  formatMocchinNo,
  mocchinNextStep,
  mocchinPaySteps,
  mocchinTransferPrefix,
  paidStepSet,
  yen,
} from '@/lib/mocchinEntry';
import { isMocchinTestEntry, loadMocchinEntryByToken, mocchinCardAmount } from '@/lib/mocchinEntryDb';
import CheckoutButton from '../CheckoutButton';
import LessonPlanPicker from './LessonPlanPicker';
import { Notice, Panel, Shell } from '../ui';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'BW6 スペシャルナンバー by MOCCHIN お支払い', robots: { index: false } };

export default async function MocchinPayPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const e = t ? await loadMocchinEntryByToken(t) : null;
  if (!e || e.status !== 'active') {
    return (
      <Shell>
        <Notice>お支払いのページが見つかりません。メールのリンクをご確認いただくか、BOOMの公式LINEからお問い合わせください。</Notice>
      </Shell>
    );
  }
  const steps = mocchinPaySteps(e.paymentPlan, e.isMember, e.appliedOn);
  const paid = paidStepSet(e.paid, e.lessonPaid);
  const next = mocchinNextStep(steps, paid);
  const needsPlan = mocchinNeedsLessonPlan(e);
  const canChoose = needsPlan && (isMocchinTestEntry(e) || todayJst() >= MOCCHIN_PLAN_INVITE_FROM);
  const planOptions = LESSON_PLANS.map((k) => ({
    key: k,
    label: LESSON_PLAN_LABEL[k],
    lines: mocchinPaySteps(k, e.isMember, e.appliedOn)
      .filter((s) => s.step > 0)
      .map((s) => `${s.label}：${yen(s.amount)}（${formatJpDate(s.due)}まで）`),
  }));

  return (
    <Shell>
      <h1 className="text-2xl font-black">お支払い</h1>
      <p className="mt-1 text-sm font-bold text-white/85">申込番号 {formatMocchinNo(e.id)}</p>
      <Panel title="お支払いの状況">
        <ul className="space-y-2 text-sm font-bold">
          {steps.map((s) => (
            <li key={s.step} className="border-b border-white/15 pb-2 last:border-0">
              {s.label}：{yen(s.amount)}
              <span className="block text-xs text-white/80">
                {paid.has(s.step) ? <span className="text-[#19F2D6]">お支払い済み</span> : `${formatJpDate(s.due)} まで`}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      {canChoose && (
        <Panel title="レッスン代の払い方を選んでください">
          <p className="mb-3 text-xs font-bold text-white/80">選ぶ期限：{formatJpDate(MOCCHIN_PLAN_CHOOSE_BY)}。決めたあと、このページからカードでも払えます。</p>
          <LessonPlanPicker token={e.payToken} options={planOptions} />
        </Panel>
      )}
      {needsPlan && !canChoose && (
        <Notice>
          参加費のお支払いを確認しました。ありがとうございます！レッスン代の払い方は、{formatJpDate(MOCCHIN_DEADLINE)}の締切のあと、{formatJpDate(MOCCHIN_PLAN_INVITE_FROM)}にメールでご案内します。
        </Notice>
      )}
      {next ? (
        <>
          <Panel title="カードで支払う">
            <p className="text-sm font-bold">次のお支払い：{next.label} {yen(next.amount)}</p>
            {isMocchinTestEntry(e) && <p className="mt-1 text-sm font-black text-[#FF4DB8]">動作確認の申込なので、カードの請求は{yen(mocchinCardAmount(e, next))}です</p>}
            <CheckoutButton token={e.payToken} label={`カードで ${yen(mocchinCardAmount(e, next))} を支払う`} />
            <p className="mt-2 text-xs font-bold text-white/75">カードの手数料はかかりません。お支払いのあと、反映まで少し時間がかかることがあります。</p>
          </Panel>
          <Panel title="銀行振込で支払う">
            <p className="text-sm font-bold">
              {MOCCHIN_BANK.bank} {MOCCHIN_BANK.branch}
              <br />
              {MOCCHIN_BANK.type} {MOCCHIN_BANK.number}
              <br />
              口座名義：{MOCCHIN_BANK.holder}
            </p>
            <p className="mt-2 text-xs font-bold text-white/75">
              振込名義の前に、申込番号「{mocchinTransferPrefix(e.id)}」を付けてください。振込手数料はご負担をお願いします。
            </p>
          </Panel>
        </>
      ) : needsPlan ? null : (
        <Notice>お支払いはすべて完了しています。ありがとうございます！</Notice>
      )}
      {!needsPlan && e.paymentPlan === 'pending' && (
        <p className="mt-3 text-xs font-bold text-white/75">
          レッスン代の払い方は、{formatJpDate(MOCCHIN_DEADLINE)}の締切のあと、参加費のお支払いが済んだ方に{formatJpDate(MOCCHIN_PLAN_INVITE_FROM)}にメールでご案内します。
        </p>
      )}
    </Shell>
  );
}
