import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { todayJst } from '@/lib/dateJst';
import { decideTargets, type MemberRow, type LinkRow, type TrialRow } from '@/lib/lstepMemberTagTargets';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/cron/lstep-member-tag-targets
//
// 入会済みの人のLINEアカウント(Lステップの友だちID)と、付けるべき入会タグの種類
// (member=本人 / guardian=保護者) を返す読み取り専用API。
// 呼び出しは boom-events-hub の GitHub Actions (Lステップ入会タグの自動付与)。
// 判定ロジックは src/lib/lstepMemberTagTargets.ts。
//
// 返すのは友だちIDとHACOMONOのメンバーIDだけ。氏名は返さない。
// ⚠️ withAuth ではなく cron の共有シークレットで認証する。理由: 呼び出し元がGitHub Actions
// (スタッフのログインセッションを持たない)。他の /api/cron/* と同じ方式・未設定なら拒否。
function authorized(req: NextRequest): boolean {
  const secrets = [process.env.REPORT_SECRET, process.env.CRON_SECRET].filter(Boolean);
  if (secrets.length === 0) return false;
  const bearer = req.headers.get('authorization');
  const header = req.headers.get('x-cron-secret');
  return secrets.some((s) => bearer === `Bearer ${s}` || header === s);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });

  const members = (await getAll(
    `SELECT id, hacomono_member_id, full_name, full_name_kana, member_type, birthday
       FROM boom_members WHERE status = 'active'`,
  )) as MemberRow[];
  const links = (await getAll(
    `SELECT member_id, lstep_id, relation, confidence FROM member_lstep_links`,
  )) as LinkRow[];
  const trials = (await getAll(
    `SELECT lstep_id, enrolled_member_id, applicant_name, applicant_name_kana, applicant_age
       FROM trial_records
      WHERE enrolled_member_id IS NOT NULL AND lstep_id IS NOT NULL AND lstep_id <> ''`,
  )) as TrialRow[];

  const { targets, review } = decideTargets({ members, links, trials, today: todayJst() });
  return NextResponse.json({ ok: true, targets, review });
}
