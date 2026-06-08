import { NextRequest, NextResponse } from 'next/server';
import { getAll, execute } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/notifications
// Query params: status ('unacknowledged' | 'all'), limit (default 50), type (optional)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const params = req.nextUrl.searchParams;
  const status = params.get('status') ?? 'unacknowledged';
  const limit = Math.min(Math.max(parseInt(params.get('limit') ?? '50', 10) || 50, 1), 200);
  const type = params.get('type');

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (status === 'unacknowledged') {
    conditions.push('n.acknowledged_at IS NULL');
  }
  if (type) {
    conditions.push('n.type = ?');
    args.push(type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await getAll(
    `SELECT n.id, n.type, n.title, n.detail, n.severity,
            n.related_member_id, n.related_lstep_id,
            n.acknowledged_at, n.acknowledged_by, n.created_at,
            m.full_name AS member_full_name,
            m.full_name_kana AS member_full_name_kana
     FROM staff_notifications n
     LEFT JOIN boom_members m ON m.id = n.related_member_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT ?`,
    [...args, limit]
  );

  return NextResponse.json({ notifications: rows });
}

// POST /api/staff/notifications — acknowledge
// Body: { id: number } or { ids: number[] }
export async function POST(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  try {
    const body = await req.json();
    const ids: number[] = [];

    if (typeof body.id === 'number') {
      ids.push(body.id);
    } else if (Array.isArray(body.ids)) {
      for (const id of body.ids) {
        if (typeof id === 'number') ids.push(id);
      }
    }

    if (ids.length === 0) {
      return NextResponse.json({ error: 'id または ids を指定してください' }, { status: 400 });
    }

    const placeholders = ids.map(() => '?').join(',');
    await execute(
      `UPDATE staff_notifications
       SET acknowledged_at = CURRENT_TIMESTAMP, acknowledged_by = 'staff'
       WHERE id IN (${placeholders}) AND acknowledged_at IS NULL`,
      ids
    );

    return NextResponse.json({ ok: true, acknowledged: ids.length });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
