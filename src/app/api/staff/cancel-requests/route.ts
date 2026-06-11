import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/cancel-requests?status=pending|all
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const url = new URL(req.url);
  const rawStatus = url.searchParams.get('status') ?? 'pending';
  // SQLインジェクション防止(T-169): statusはallowlist + バインド変数で渡す。
  const allowed = ['pending', 'approved', 'rejected', 'all'];
  const status = allowed.includes(rawStatus) ? rawStatus : 'pending';
  const where = status === 'all' ? '' : 'WHERE cr.status = ?';
  const args = status === 'all' ? [] : [status];
  const rows = await getAll(
    `SELECT cr.*,
            i.name AS instructor_name,
            i.contact_email AS instructor_email,
            sub.name AS substitute_name
     FROM lesson_cancel_requests cr
     LEFT JOIN instructors i ON i.id = cr.instructor_id
     LEFT JOIN instructors sub ON sub.id = cr.substitute_instructor_id
     ${where}
     ORDER BY cr.lesson_date DESC, cr.created_at DESC LIMIT 100`,
    args
  );
  return NextResponse.json({ requests: rows });
}
