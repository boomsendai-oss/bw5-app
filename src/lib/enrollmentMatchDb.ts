// src/lib/enrollmentMatchDb.ts — 体験×入会の突合をDBに反映する実行部 (WS AA)
//
// 純ロジックは enrollmentMatch.ts (単体テスト付き)。ここはその結果を trial_records に書く側。
//
// 元は match-enrollments/route.ts に同居していたが、route.ts から POST 以外を export すると
// Next.js 16 のルート型検証が
//   「Route ... does not match the required types of a Next.js Route」
// で **next build を失敗させる** (tsc --noEmit では検出されない)。sync/route.ts からも
// 呼ぶ必要があるため lib 側に出した。route.ts には HTTP ハンドラと設定だけ置くこと。

import { getAll, batch } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';
import { matchEnrollments, type TrialForMatch, type MemberForMatch } from '@/lib/enrollmentMatch';

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
    `SELECT id, applicant_name_kana, reserved_at, matched_by, status, attendance_override,
            enrolled_after, enrolled_member_id
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
