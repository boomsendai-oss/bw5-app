// スタッフ: BW6スペシャルナンバー by MOCCHIN の申込一覧(入金の手動チェック・取消・CSV)。
// 個人情報を出すので、proxyのcookie確認に加えてセッションを本検証する(規約4.5)。
import { redirect } from 'next/navigation';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { todayJst } from '@/lib/dateJst';
import { xmasPreviewKey } from '@/lib/partyPreview';
import { mocchinGate, mocchinPaySteps, paidStepSet, yen } from '@/lib/mocchinEntry';
import { MOCCHIN_SETTINGS_KEY, getMocchinCapacity, listMocchinEntries } from '@/lib/mocchinEntryDb';
import EntryTable from './EntryTable';

export const dynamic = 'force-dynamic';

const GATE_LABEL = { before: '受付開始前(11/8から)', member: '会員の先行期間', open: '受付中(誰でも)', closed: '締切' } as const;

export default async function StaffMocchinPage() {
  if (!(await isAuthorizedServer())) redirect('/staff/events/login');
  const [rows, capacity] = await Promise.all([listMocchinEntries(), getMocchinCapacity()]);
  const active = rows.filter((r) => r.status === 'active');
  const today = todayJst();
  // 入金は支払い回ごとに持つ。「入金済み」は全部の回が終わった人、金額は実際に入った分の合計
  const steps = active.map((r) => ({ all: mocchinPaySteps(r.paymentPlan, r.isMember, r.appliedOn), done: paidStepSet(r.paid, r.lessonPaid) }));
  const fullyPaid = steps.filter((s) => s.all.every((x) => s.done.has(x.step))).length;
  const received = steps.reduce((sum, s) => sum + s.all.filter((x) => s.done.has(x.step)).reduce((a, x) => a + x.amount, 0), 0);
  const late = steps.filter((s) => s.all.some((x) => !s.done.has(x.step) && today > x.due)).length;
  const members = active.filter((r) => r.isMember);
  const previewUrl = `/mocchin?preview=${xmasPreviewKey(MOCCHIN_SETTINGS_KEY)}`;

  return (
    <div>
      <StaffPageHeader
        title="BW6 MOCCHINナンバー 申込"
        description={`${GATE_LABEL[mocchinGate(today)]} ・ 会員先行 11/8〜11/14 ・ 誰でも 11/15〜12/13`}
        rightExtra={
          <div className="flex flex-wrap gap-2 text-sm">
            <a href="/mocchin" target="_blank" rel="noreferrer" className="rounded-md border border-sand-200 px-3 py-1 text-brand-700">
              公開ページ
            </a>
            <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-md border border-sand-200 px-3 py-1 text-brand-700">
              プレビュー
            </a>
          </div>
        }
      />
      <div className="mx-auto max-w-6xl space-y-6 p-4">
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="申込(有効)" value={`${active.length} / 定員${capacity}`} />
          <Card label="うち会員" value={`${members.length}`} sub={`会員以外 ${active.length - members.length}`} />
          <Card label="全額入金済み" value={`${fullyPaid}`} sub={`期限切れあり ${late}`} />
          <Card label="入金額" value={yen(received)} />
        </section>
        <EntryTable rows={rows} capacity={capacity} today={today} />
        <p className="text-xs text-neutral-500">
          入金の照合: 振込名義の頭に申込番号(例 MC001)が付いています。期限の3日前になると、未入金の方へお知らせメールが自動で届きます(毎朝9時)。プレビューのURLは受付開始前でも申込画面を開けます(そこから送った申込は備考に「テスト」と付きます)。
        </p>
      </div>
    </div>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-sand-200 bg-white p-3">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-navy-900">{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}
