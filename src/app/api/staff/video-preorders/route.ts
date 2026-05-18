import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/video-preorders
// 映像予約の全件取得 (確認メール送信履歴含む)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();

  const rows = await getAll(`
    SELECT
      vp.id,
      vp.merch_id,
      vp.buyer_name,
      vp.email,
      vp.phone,
      vp.note,
      vp.status,
      vp.created_at,
      vp.confirmation_email_sent_at,
      vp.payment_link_sent_at,
      vp.payment_paid_at,
      m.name AS merch_name,
      m.price
    FROM video_preorders vp
    LEFT JOIN merchandise m ON m.id = vp.merch_id
    ORDER BY vp.id DESC
  `);

  return NextResponse.json({ preorders: rows });
}
