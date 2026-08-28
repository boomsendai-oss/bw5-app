// アンケート一覧 (Server Component)。作成→発行→集計・紐付けの入口。
import Link from 'next/link';
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { listSurveys } from '@/lib/surveyDb';
import { effectiveState } from '@/lib/survey';
import SurveyListClient from './SurveyListClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SurveysPage() {
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="📋 アンケート" backHref="/staff" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }

  const surveys = await listSurveys();
  const items = surveys.map((s) => ({
    id: s.id,
    slug: s.slug,
    title: s.title,
    status: s.status,
    state: effectiveState(s),
    opensAt: s.opens_at,
    closesAt: s.closes_at,
    responseCount: s.responseCount,
    pendingCount: s.pendingCount,
  }));

  return (
    <div>
      <StaffPageHeader
        title="📋 アンケート"
        description="作成→発行(URLをLINEで配布)→集計・会員紐付け"
        rightExtra={
          <Link
            href="/staff/surveys/new"
            className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-brand-700"
          >
            ＋ 新規作成
          </Link>
        }
      />
      <div className="p-4 max-w-6xl mx-auto">
        <SurveyListClient items={items} />
      </div>
    </div>
  );
}
