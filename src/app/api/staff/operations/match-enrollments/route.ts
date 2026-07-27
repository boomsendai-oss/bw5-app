import { NextResponse } from 'next/server';
import { getAll, batch } from '@/lib/db';
import { withAuth } from '@/lib/eventAuth';
import { nowUtcIso } from '@/lib/dateJst';
import { matchEnrollments, type TrialForMatch, type MemberForMatch } from '@/lib/enrollmentMatch';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/staff/operations/match-enrollments
 *
 * 体験予約(trial_records) と 入会会員(boom_members) をカナ+日付窓で突合し、
 * enrolled_after / enrolled_member_id / matched_by / matched_at を埋める。
 *
 * 冪等。日次同期(会員CSVが揃った時のみ)と手動再実行の両方から呼ばれる。
 * matched_by='manual' の行は対象外(人の判断を上書きしない)。
 */
export const POST = withAuth(async () => {
  try {
    const result = await runEnrollmentMatch();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[match-enrollments POST]', e);
    return NextResponse.json({ error: '突合処理に失敗しました' }, { status: 500 });
  }
});

export type MatchSummary = {
  ok: true;
  trials_scanned: number;
  members_scanned: number;
  matched: number;
  newly_matched: number;
  cleared: number;
  ambiguous: { trial_id: number; member_ids: number[] }[];
};

export async function runEnrollmentMatch(): Promise<MatchSummary> {
  const trials = (await getAll(
    `SELECT id, applicant_name_kana, reserved_at, matched_by, enrolled_after, enrolled_member_id
       FROM trial_records`
  )) as (TrialForMatch & { enrolled_after: number; enrolled_member_id: number | null })[];

  const members = (await getAll(
    `SELECT id, full_name_kana, enrolled_at FROM boom_members WHERE enrolled_at IS NOT NULL`
  )) as MemberForMatch[];

  const { matches, ambiguous } = matchEnrollments(trials, members);

  const at = nowUtcIso();
  const desired = new Map(matches.map((m) => [m.trial_id, m.member_id]));
  const stmts: { sql: string; args: (string | number | null)[] }[] = [];
  let newlyMatched = 0;
  let cleared = 0;

  for (const t of trials) {
    if ((t.matched_by ?? '') === 'manual') continue;
    const want = desired.get(t.id) ?? null;
    const have = t.enrolled_member_id ?? null;
    if (want === have) continue;

    if (want === null) {
      // 以前 kana_auto で付いていたが条件を満たさなくなった(会員の入会日修正等)。戻す。
      stmts.push({
        sql: `UPDATE trial_records
                 SET enrolled_after = 0, enrolled_member_id = NULL, matched_by = NULL, matched_at = ?
               WHERE id = ?`,
        args: [at, t.id],
      });
      cleared += 1;
    } else {
      stmts.push({
        sql: `UPDATE trial_records
                 SET enrolled_after = 1, enrolled_member_id = ?, matched_by = 'kana_auto', matched_at = ?
               WHERE id = ?`,
        args: [want, at, t.id],
      });
      newlyMatched += 1;
    }
  }

  for (let i = 0; i < stmts.length; i += 50) {
    await batch(stmts.slice(i, i + 50));
  }

  return {
    ok: true,
    trials_scanned: trials.length,
    members_scanned: members.length,
    matched: matches.length,
    newly_matched: newlyMatched,
    cleared,
    ambiguous,
  };
}
