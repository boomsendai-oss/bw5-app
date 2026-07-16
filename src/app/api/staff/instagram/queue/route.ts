import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getOne, execute } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/staff/instagram/queue { id, action: 'approve' | 'reject' }
// 埋め草キューの承認/却下(TAROが /staff/instagram から操作)。
// 遷移は pending → approved / rejected のみ許可(posted/expired等は触らない)。
export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const action = body?.action;
  if (!Number.isInteger(id) || !['approve', 'reject'].includes(action)) {
    return NextResponse.json({ error: 'id と action(approve|reject) が必要です' }, { status: 400 });
  }

  const row = await getOne('SELECT id, status FROM story_queue WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: `queue#${id} が見つかりません` }, { status: 404 });
  if (row.status !== 'pending') {
    return NextResponse.json({ error: `queue#${id} は pending ではありません(現在: ${row.status})` }, { status: 409 });
  }

  const nextStatus = action === 'approve' ? 'approved' : 'rejected';
  await execute('UPDATE story_queue SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?', [
    nextStatus,
    id,
    'pending',
  ]);
  return NextResponse.json({ ok: true, id, status: nextStatus });
}
