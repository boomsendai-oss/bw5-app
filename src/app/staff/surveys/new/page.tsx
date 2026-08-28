// アンケート新規作成 (Server Component + client SurveyBuilder)。
import StaffPageHeader from '@/components/StaffPageHeader';
import { isAuthorizedServer } from '@/lib/eventAuth';
import SurveyBuilder from '../SurveyBuilder';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function NewSurveyPage() {
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="アンケート新規作成" backHref="/staff/surveys" backLabel="アンケート一覧" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <StaffPageHeader
        title="📋 アンケート新規作成"
        description="下書きとして作成→内容確認→発行でURLが配布可能になります"
        backHref="/staff/surveys"
        backLabel="アンケート一覧"
      />
      <div className="p-4 max-w-3xl mx-auto">
        <SurveyBuilder />
      </div>
    </div>
  );
}
