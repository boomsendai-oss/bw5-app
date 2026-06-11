import { NextRequest, NextResponse } from 'next/server';
import { execute, getOne } from '@/lib/db';
import { isAuthorized, unauthorized } from '@/lib/eventAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/staff/gbp-reviews/[id]/skip - 返信不要としてマーク
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized(req))) return unauthorized();
  const { id } = await ctx.params;
  const row = await getOne(`SELECT review_id FROM gbp_reviews WHERE review_id=?`, [id]);
  if (!row) return NextResponse.json({ error: 'クチコミが見つかりません' }, { status: 404 });
  await execute(`UPDATE gbp_reviews SET status='skipped' WHERE review_id=?`, [id]);
  return NextResponse.json({ ok: true });
}
