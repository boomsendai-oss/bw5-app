import { NextRequest, NextResponse } from 'next/server';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { getOne, getAll, execute } from '@/lib/db';
import { nowUtcIso } from '@/lib/dateJst';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/instagram/reels — リール投稿キューの一覧(予定+履歴)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const reels = await getAll(
    `SELECT id, title, video_path, cover_path, caption, scheduled_at, status, ig_media_id, permalink, error, posted_at
     FROM reel_queue
     ORDER BY CASE WHEN status IN ('scheduled', 'posting') THEN 0 ELSE 1 END, scheduled_at DESC
     LIMIT 30`
  );
  return NextResponse.json({ reels });
}

// PATCH /api/staff/instagram/reels { id, action: 'cancel' | 'reschedule', scheduledAt? }
// TAROが /staff/instagram から予定をキャンセル(or 失敗分を再スケジュール)する。
export async function PATCH(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  const action = body?.action;
  if (!Number.isInteger(id) || !['cancel', 'reschedule'].includes(action)) {
    return NextResponse.json({ error: 'id と action(cancel|reschedule) が必要です' }, { status: 400 });
  }

  const row = await getOne('SELECT id, status FROM reel_queue WHERE id = ?', [id]);
  if (!row) return NextResponse.json({ error: `reel#${id} が見つかりません` }, { status: 404 });

  if (action === 'cancel') {
    if (row.status !== 'scheduled') {
      return NextResponse.json({ error: `reel#${id} は scheduled ではありません(現在: ${row.status})` }, { status: 409 });
    }
    await execute(`UPDATE reel_queue SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'scheduled'`, [
      nowUtcIso(),
      id,
    ]);
    return NextResponse.json({ ok: true, id, status: 'canceled' });
  }

  // reschedule: canceled/failed → scheduled に戻す(日時指定があれば差し替え)
  if (!['canceled', 'failed'].includes(String(row.status))) {
    return NextResponse.json({ error: `reel#${id} は canceled/failed ではありません(現在: ${row.status})` }, { status: 409 });
  }
  const scheduledAt = typeof body?.scheduledAt === 'string' && body.scheduledAt ? body.scheduledAt : null;
  await execute(
    `UPDATE reel_queue SET status = 'scheduled', error = NULL, scheduled_at = COALESCE(?, scheduled_at), updated_at = ? WHERE id = ?`,
    [scheduledAt, nowUtcIso(), id]
  );
  return NextResponse.json({ ok: true, id, status: 'scheduled' });
}
