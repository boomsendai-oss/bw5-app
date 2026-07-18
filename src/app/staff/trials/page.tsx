// 体験予約 担当周知(WS T / 2026-07-18) — Server Component
// 今日以降の体験予約を「日付×レッスン枠」でまとめて表示。TARO/KEIKOが枠ごとに
// ワンタップでコピー→個人LINEに貼り付けて担当インストラクターへ送る運用。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getAll, getOne } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { buildTrialGroups, type TrialRow } from '@/lib/trialNotify';
import TrialCopyList from './TrialCopyList';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** 現在のJST日付 'YYYY-MM-DD' */
function todayJst(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}

/** UTCの 'YYYY-MM-DD HH:MM:SS' を JSTの 'M/D HH:MM' 表示に。 */
function toJstLabel(utc: string | null): string | null {
  if (!utc) return null;
  const dt = new Date(utc.replace(' ', 'T') + 'Z');
  if (isNaN(dt.getTime())) return null;
  return dt.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function TrialsPage() {
  const authed = await isAuthorizedServer();
  if (!authed) {
    return (
      <div>
        <StaffPageHeader title="体験予約" backHref="/staff" />
        <div className="p-4 max-w-3xl mx-auto">
          <p className="text-sm text-muted-foreground">
            ログインが必要です。<a href="/staff" className="text-brand-600 underline">スタッフトップ</a>からログインしてください。
          </p>
        </div>
      </div>
    );
  }

  const today = todayJst();
  const rows = (await getAll(
    `SELECT reserved_at, lesson_name, status,
            applicant_name, applicant_name_kana, applicant_age,
            course_type, dance_experience, referral_source
       FROM trial_records
      WHERE date(reserved_at) >= date(?)
      ORDER BY reserved_at ASC`,
    [today]
  )) as TrialRow[];

  const groups = buildTrialGroups(rows);
  const visitorCount = groups.reduce((n, g) => n + g.visitors.length, 0);

  const freshRow = (await getOne(
    `SELECT MAX(status_updated_at) AS last FROM trial_records`
  )) as { last: string | null } | null;
  const lastImport = toJstLabel(freshRow?.last ?? null);

  return (
    <div className="text-foreground">
      <StaffPageHeader
        title="体験予約"
        description="担当インストラクターへの周知用。枠ごとにコピー→LINEで送信"
        backHref="/staff"
      />
      <div className="max-w-3xl mx-auto p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap text-xs text-muted-foreground">
          <span>
            今日以降の体験 <span className="font-bold text-navy-800">{visitorCount}</span> 名 / {groups.length} 枠
          </span>
          {lastImport && <span>最終取込: {lastImport}</span>}
        </div>
        <TrialCopyList groups={groups} todayLabel={today} />
      </div>
    </div>
  );
}
