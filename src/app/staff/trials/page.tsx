// 体験予約 担当周知(WS T / 2026-07-18) — Server Component
// 今日以降の体験予約を「日付×レッスン枠」でまとめて表示。TARO/KEIKOが枠ごとに
// ワンタップでコピー→個人LINEに貼り付けて担当インストラクターへ送る運用。
import StaffPageHeader from '@/components/StaffPageHeader';
import { getAll, getOne } from '@/lib/db';
import { isAuthorizedServer } from '@/lib/eventAuth';
import { buildTrialGroups, formatDateLabel, resolveVisitorName, type TrialRow } from '@/lib/trialNotify';
import TrialCopyList from './TrialCopyList';
import NoshowCorrections, { type PastTrial } from './NoshowCorrections';

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

  // 直近45日分の実施済み体験 — 来店訂正用 (WS AA)。trialAttendance.ts の判定は日数の
  // 上限なしに過去の非キャンセルを「来店」扱いし続けるため、月次KPIレビュー(先月分の
  // 見直し)で気づいたノーショーも直せるよう前月レビューを余裕を持ってカバーする45日
  // とした。トレードオフ: これより古い訂正はこの画面からはできない。
  // status の比較は trialAttendance.ts の判定(.trim()込み)と揃えるため TRIM する
  // (例: ' キャンセル' のような先頭空白混入時に判定がズレるのを防ぐ)。
  //
  // ⚠️ attendance_override はマイグレーション未適用の本番でも動くように保護する。
  // 本番は SKIP_DB_INIT=1 でマイグレーションが自動実行されず、デプロイはmainへのpushで
  // 自動的に走る。列が無い状態でこのクエリが落ちるとページ全体(講師周知リスト)が
  // 500になるため、訂正UIだけを縮退させる。
  let pastTrials: PastTrial[] = [];
  try {
    const pastRows = (await getAll(
      `SELECT id, reserved_at, lesson_name, status, attendance_override,
              applicant_name, applicant_name_kana
         FROM trial_records
        WHERE date(reserved_at) < date(?) AND date(reserved_at) >= date(?, '-45 day')
          AND TRIM(COALESCE(status, '')) <> 'キャンセル'
        ORDER BY reserved_at DESC`,
      [today, today]
    )) as {
      id: number;
      reserved_at: string;
      lesson_name: string | null;
      status: string | null;
      attendance_override: string | null;
      applicant_name: string | null;
      applicant_name_kana: string | null;
    }[];

    pastTrials = pastRows.map((r) => {
      const date = r.reserved_at.slice(0, 10);
      const time = r.reserved_at.slice(11, 16);
      return {
        id: r.id,
        reservedLabel: `${formatDateLabel(date)} ${time}`,
        name: resolveVisitorName(r.applicant_name, r.applicant_name_kana),
        lessonName: r.lesson_name ?? '',
        attendanceOverride: r.attendance_override,
      };
    });
  } catch (e) {
    console.error('[trials/page pastRows]', e);
    pastTrials = [];
  }

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
        <NoshowCorrections
          key={pastTrials.map((t) => `${t.id}:${t.attendanceOverride ?? ''}`).join(',')}
          trials={pastTrials}
        />
      </div>
    </div>
  );
}
