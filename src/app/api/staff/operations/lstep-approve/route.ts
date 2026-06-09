import { NextRequest, NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/operations/lstep-approve
// body:
//   { action: 'approve'|'reject', ids: number[] }            個別の変更を承認/却下
//   { action: 'approve'|'reject', batch_id: number, all: true } バッチ内の未判断(pending)を一括
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  let body: { action?: string; ids?: unknown; batch_id?: unknown; all?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'JSON が不正です' }, { status: 400 });
  }

  const action = body.action === 'reject' ? 'rejected' : body.action === 'approve' ? 'approved' : null;
  if (!action) {
    return NextResponse.json({ error: "action は approve / reject" }, { status: 400 });
  }

  // 一括 (batch_id + all)
  if (body.all === true && body.batch_id != null) {
    const batchId = Number(body.batch_id);
    if (!Number.isInteger(batchId) || batchId <= 0) {
      return NextResponse.json({ error: 'batch_id が不正です' }, { status: 400 });
    }
    const res = await execute(
      `UPDATE lstep_pending_changes
          SET status = ?, decided_at = CURRENT_TIMESTAMP
        WHERE batch_id = ? AND status = 'pending'`,
      [action, batchId]
    );
    return NextResponse.json({ ok: true, updated: Number(res.rowsAffected ?? 0) });
  }

  // 個別 (ids)
  const ids = Array.isArray(body.ids) ? body.ids.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: 'ids または (batch_id + all) が必要です' }, { status: 400 });
  }
  const placeholders = ids.map(() => '?').join(',');
  const res = await execute(
    `UPDATE lstep_pending_changes
        SET status = ?, decided_at = CURRENT_TIMESTAMP
      WHERE id IN (${placeholders}) AND status IN ('pending','approved','rejected')`,
    [action, ...ids]
  );
  return NextResponse.json({ ok: true, updated: Number(res.rowsAffected ?? 0) });
}
