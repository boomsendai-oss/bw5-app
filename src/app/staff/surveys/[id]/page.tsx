// アンケート詳細 (Server Component): 集計・回答一覧・会員紐付け・発行/終了・編集。
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { getSurveyById, listResponses, loadAnswerRows } from '@/lib/surveyDb';
import { effectiveState } from '@/lib/survey';
import SurveyDetailClient from './SurveyDetailClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function SurveyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="アンケート" backHref="/staff/surveys" backLabel="アンケート一覧" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }
  const survey = Number.isInteger(id) && id > 0 ? await getSurveyById(id) : null;
  if (!survey) {
    return (
      <div>
        <StaffPageHeader title="アンケート" backHref="/staff/surveys" backLabel="アンケート一覧" />
        <div className="p-4 max-w-3xl mx-auto text-sm text-slate-500">アンケートが見つかりません。</div>
      </div>
    );
  }
  const [responses, answerRows] = await Promise.all([listResponses(survey.id), loadAnswerRows(survey.id)]);

  return (
    <div>
      <StaffPageHeader
        title={`📋 ${survey.title}`}
        description={`回答 ${responses.length}件`}
        backHref="/staff/surveys"
        backLabel="アンケート一覧"
      />
      <div className="p-4 max-w-6xl mx-auto">
        <SurveyDetailClient
          survey={{
            id: survey.id,
            slug: survey.slug,
            title: survey.title,
            intro: survey.intro ?? '',
            nameNote: survey.name_note ?? '',
            nameRequired: survey.name_required,
            audience: survey.audience,
            status: survey.status,
            state: effectiveState(survey),
            opensAt: survey.opens_at ?? '',
            closesAt: survey.closes_at ?? '',
            questions: survey.questions,
          }}
          responses={responses}
          answerRows={answerRows}
        />
      </div>
    </div>
  );
}
