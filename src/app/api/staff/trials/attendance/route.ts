import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { withAuth } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/staff/trials/attendance
 * body: { trial_id: number, override: 'noshow' | null }
 *
 * 来店判定の人手による訂正。status 列は Lstep CSV が正本で再取込のたびに
 * 上書きされるため、訂正は attendance_override に持つ。
 */
export const POST = withAuth(async (req: NextRequest) => {
  const body = (await req.json().catch(() => null)) as
    | { trial_id?: number; override?: string | null }
    | null;
  const trialId = Number(body?.trial_id);
  if (!Number.isFinite(trialId) || trialId <= 0) {
    return NextResponse.json({ error: 'trial_id が不正です' }, { status: 400 });
  }
  const raw = body?.override ?? null;
  if (raw !== null && raw !== 'noshow') {
    return NextResponse.json({ error: "override は 'noshow' か null のみです" }, { status: 400 });
  }
  await execute(`UPDATE trial_records SET attendance_override = ? WHERE id = ?`, [raw, trialId]);
  return NextResponse.json({ ok: true, trial_id: trialId, override: raw });
});
