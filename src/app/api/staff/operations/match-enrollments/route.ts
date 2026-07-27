import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/eventAuth';
import { runEnrollmentMatch } from '@/lib/enrollmentMatchDb';

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
 *
 * 実処理は `@/lib/enrollmentMatchDb`。**このファイルに POST 以外を export しないこと**
 * (Next.js 16 のルート型検証が next build を落とす)。
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
