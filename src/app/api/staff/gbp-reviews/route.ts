import { NextRequest, NextResponse } from 'next/server';
import { getAll } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';
import { gbpConfigured } from '@/lib/gbp';
import { draftConfigured } from '@/lib/gbpDraft';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/staff/gbp-reviews - 承認キュー一覧 (未対応を上に)
export async function GET(req: NextRequest) {
  if (!(await isAuthorized(req))) return unauthorized();
  const reviews = await getAll(
    `SELECT review_id, reviewer_name, star_rating, comment, create_time, update_time,
            reply_comment, reply_time, status, draft, drafted_at, posted_at
     FROM gbp_reviews
     ORDER BY CASE status WHEN 'draft_ready' THEN 0 WHEN 'new' THEN 1 ELSE 2 END,
              create_time DESC`
  );
  return NextResponse.json({
    reviews,
    gbp_configured: gbpConfigured(),
    draft_configured: draftConfigured(),
  });
}
